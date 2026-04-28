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

    const channel: Channel = { id: frame.channelId, session, pty };
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
        if (channel) channel.pty.resize(frame.cols, frame.rows);
        return;
      }
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
