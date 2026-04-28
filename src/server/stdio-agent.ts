import { EventEmitter } from 'node:events';
import { buildPtyCommand, buildPtyEnv, sanitizeSession, spawnPty, type BunPty } from './pty.js';
import {
  decodePtyBytes,
  encodeFrame,
  encodePtyBytes,
  FrameDecoder,
  type StdioFrame,
} from './stdio-protocol.js';
import type { TmuxControl } from './tmux-control.js';
import { routeClientMessage, type PendingRead, type WsAction } from './ws-router.js';

export interface AgentPtyFactoryOptions {
  session: string;
  cols: number;
  rows: number;
}

export type AgentPtyFactory = (opts: AgentPtyFactoryOptions) => BunPty;

export interface StdioAgentOptions {
  input: EventEmitter;
  write: (buf: Buffer) => unknown;
  makePty?: AgentPtyFactory;
  tmuxControl: TmuxControl;
  version: string;
  tmuxBin?: string;
  tmuxConfPath?: string;
}

interface Channel {
  id: string;
  session: string;
  pty: BunPty;
  pendingReads: Map<string, PendingRead>;
  lastSize: { cols: number; rows: number };
}

export function eventInputFromNodeReadable(input: NodeJS.ReadableStream): EventEmitter {
  const emitter = new EventEmitter();
  input.on('data', chunk => emitter.emit('data', Buffer.from(chunk)));
  input.on('end', () => emitter.emit('end'));
  input.on('error', err => emitter.emit('error', err));
  return emitter;
}

export function runStdioAgent(opts: StdioAgentOptions): { close: () => void } {
  const decoder = new FrameDecoder();
  const channels = new Map<string, Channel>();
  let closed = false;

  const send = (frame: StdioFrame): void => {
    try {
      opts.write(encodeFrame(frame));
    } catch {
      closeAll();
    }
  };

  const makePty = opts.makePty ?? ((p: AgentPtyFactoryOptions) => spawnPty({
    command: buildPtyCommand({
      testMode: false,
      session: p.session,
      tmuxConfPath: opts.tmuxConfPath ?? '',
      tmuxBin: opts.tmuxBin ?? 'tmux',
    }),
    env: buildPtyEnv(),
    cols: p.cols,
    rows: p.rows,
  }));

  const closeChannel = (channelId: string, closeOpts: { kill?: boolean } = {}): void => {
    const channel = channels.get(channelId);
    if (!channel) return;
    channels.delete(channelId);
    if (closeOpts.kill !== false) {
      try { channel.pty.kill(); } catch { /* best-effort */ }
    }
    try { opts.tmuxControl.detachSession(channel.session); } catch { /* best-effort */ }
  };

  function closeAll(): void {
    if (closed) return;
    closed = true;
    for (const id of [...channels.keys()]) closeChannel(id);
  }

  const removeInputListeners = (): void => {
    opts.input.off('data', onData);
    opts.input.off('end', onEnd);
    opts.input.off('error', onError);
  };

  const closeFatal = (frame: Extract<StdioFrame, { type: 'host-error' }>): void => {
    if (closed) return;
    send(frame);
    removeInputListeners();
    closeAll();
  };

  const open = (frame: Extract<StdioFrame, { type: 'open' }>): void => {
    if (channels.has(frame.channelId)) {
      closeChannel(frame.channelId);
    }

    const session = sanitizeSession(frame.session);
    let pty: BunPty;
    try {
      pty = makePty({ session, cols: frame.cols, rows: frame.rows });
    } catch (err) {
      send({
        v: 1,
        type: 'channel-error',
        channelId: frame.channelId,
        code: 'pty-spawn-failed',
        message: err instanceof Error ? err.message : String(err),
      });
      return;
    }

    if (pty.spawnError) {
      send({
        v: 1,
        type: 'channel-error',
        channelId: frame.channelId,
        code: 'pty-spawn-failed',
        message: pty.spawnError.message,
      });
      return;
    }

    const channel: Channel = {
      id: frame.channelId,
      session,
      pty,
      pendingReads: new Map(),
      lastSize: { cols: frame.cols, rows: frame.rows },
    };
    channels.set(frame.channelId, channel);
    pty.onData((data) => {
      if (channels.get(frame.channelId) !== channel) return;
      send(encodePtyBytes(frame.channelId, Buffer.from(data, 'utf8'), 'pty-out'));
    });
    pty.onExit(() => {
      if (channels.get(frame.channelId) !== channel) return;
      send({ v: 1, type: 'server-msg', channelId: frame.channelId, data: { ptyExit: true } });
      closeChannel(frame.channelId, { kill: false });
    });

    void opts.tmuxControl.attachSession(session, { cols: frame.cols, rows: frame.rows }).catch(() => {});
    send({ v: 1, type: 'open-ok', channelId: frame.channelId, session });
  };

  const sendChannelError = (channelId: string, code: string, message: string): void => {
    send({ v: 1, type: 'channel-error', channelId, code, message });
  };

  const unsupportedClientAction = (channel: Channel, act: WsAction): void => {
    sendChannelError(channel.id, 'unsupported-client-action', `unsupported client action: ${act.type}`);
  };

  const tmuxClientForPty = async (channel: Channel): Promise<string | null> => {
    const out = await opts.tmuxControl.run([
      'list-clients',
      '-F',
      '#{client_pid}\t#{client_tty}\t#{client_name}',
    ]);
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [pid, tty, name] = line.split('\t');
      const candidate = name || tty || null;
      if (Number(pid) === channel.pty.pid) return candidate;
    }
    return null;
  };

  const tmuxClientSession = async (client: string): Promise<string | null> => {
    const out = await opts.tmuxControl.run([
      'list-clients',
      '-F',
      '#{client_tty}\t#{client_name}\t#{client_session}',
    ]);
    for (const line of out.split('\n')) {
      if (!line) continue;
      const [tty, name, session] = line.split('\t');
      if (client === tty || client === name) return session || null;
    }
    return null;
  };

  const switchChannelSession = async (channel: Channel, newSessionRaw: string): Promise<void> => {
    const oldSession = channel.session;
    const newSession = sanitizeSession(newSessionRaw);
    if (newSession === oldSession) {
      send({ v: 1, type: 'server-msg', channelId: channel.id, data: { session: newSession } });
      return;
    }

    let newSessionAttached = false;
    try {
      await opts.tmuxControl.attachSession(newSession, channel.lastSize);
      newSessionAttached = true;
      if (channels.get(channel.id) !== channel) {
        try { opts.tmuxControl.detachSession(newSession); } catch { /* best-effort */ }
        return;
      }

      const client = await tmuxClientForPty(channel);
      if (!client) throw new Error('PTY tmux client not found');
      if (channels.get(channel.id) !== channel) {
        try { opts.tmuxControl.detachSession(newSession); } catch { /* best-effort */ }
        return;
      }

      await opts.tmuxControl.run(['switch-client', '-c', client, '-t', newSession]);
      if (channels.get(channel.id) !== channel) {
        try { opts.tmuxControl.detachSession(newSession); } catch { /* best-effort */ }
        return;
      }

      const reportedSession = await tmuxClientSession(client);
      if (reportedSession !== newSession) {
        throw new Error(`PTY tmux client still on ${reportedSession ?? '<unknown>'}`);
      }
      if (channels.get(channel.id) !== channel) {
        try { opts.tmuxControl.detachSession(newSession); } catch { /* best-effort */ }
        return;
      }

      opts.tmuxControl.detachSession(oldSession);
      newSessionAttached = false;
      channel.session = newSession;
      send({ v: 1, type: 'server-msg', channelId: channel.id, data: { session: newSession } });
    } catch (err) {
      if (newSessionAttached) {
        try { opts.tmuxControl.detachSession(newSession); } catch { /* best-effort */ }
      }
      sendChannelError(
        channel.id,
        'switch-session-failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const dispatchClientAction = (channel: Channel, act: WsAction): void => {
    try {
      switch (act.type) {
        case 'pty-write':
          channel.pty.write(act.data);
          return;
        case 'pty-resize':
          channel.lastSize = { cols: act.cols, rows: act.rows };
          channel.pty.resize(act.cols, act.rows);
          return;
        case 'switch-session':
          void switchChannelSession(channel, act.name);
          return;
        case 'colour-variant':
        case 'window':
        case 'session':
        case 'scrollbar':
        case 'clipboard-deny':
        case 'clipboard-grant-persist':
        case 'clipboard-request-content':
        case 'clipboard-reply':
          unsupportedClientAction(channel, act);
          return;
      }
    } catch (err) {
      sendChannelError(
        channel.id,
        'client-action-failed',
        err instanceof Error ? err.message : String(err),
      );
    }
  };

  const handleClientMessage = (frame: Extract<StdioFrame, { type: 'client-msg' }>): void => {
    const channel = channels.get(frame.channelId);
    if (!channel) return;
    let actions: WsAction[];
    try {
      actions = routeClientMessage(frame.data, {
        currentSession: channel.session,
        pendingReads: channel.pendingReads,
      });
    } catch (err) {
      sendChannelError(
        channel.id,
        'client-message-failed',
        err instanceof Error ? err.message : String(err),
      );
      return;
    }
    for (const act of actions) dispatchClientAction(channel, act);
  };

  const onFrame = (frame: StdioFrame): void => {
    switch (frame.type) {
      case 'hello':
        send({ v: 1, type: 'hello-ok', agentVersion: opts.version });
        return;
      case 'open':
        open(frame);
        return;
      case 'pty-in': {
        const channel = channels.get(frame.channelId);
        if (!channel) return;
        try {
          channel.pty.write(decodePtyBytes(frame).toString('utf8'));
        } catch (err) {
          send({
            v: 1,
            type: 'channel-error',
            channelId: frame.channelId,
            code: 'pty-input-failed',
            message: err instanceof Error ? err.message : String(err),
          });
        }
        return;
      }
      case 'resize': {
        const channel = channels.get(frame.channelId);
        if (channel) {
          channel.lastSize = { cols: frame.cols, rows: frame.rows };
          channel.pty.resize(frame.cols, frame.rows);
        }
        return;
      }
      case 'client-msg':
        handleClientMessage(frame);
        return;
      case 'close':
        closeChannel(frame.channelId);
        return;
      case 'shutdown':
        closeAll();
        return;
    }
  };

  const onData = (chunk: Buffer | Uint8Array): void => {
    if (closed) return;
    try {
      for (const frame of decoder.push(Buffer.from(chunk))) onFrame(frame);
    } catch (err) {
      closeFatal({
        v: 1,
        type: 'host-error',
        code: 'invalid-frame',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };
  const onEnd = (): void => closeAll();
  const onError = (err: unknown): void => {
    closeFatal({
      v: 1,
      type: 'host-error',
      code: 'input-error',
      message: err instanceof Error ? err.message : String(err),
    });
  };

  opts.input.on('data', onData);
  opts.input.on('end', onEnd);
  opts.input.on('error', onError);

  return {
    close: () => {
      removeInputListeners();
      closeAll();
    },
  };
}
