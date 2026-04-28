import { EventEmitter } from 'node:events';
import { userInfo } from 'node:os';
import path from 'node:path';
import { LOCALHOST_IPS } from '../shared/constants.js';
import type { ServerConfig } from '../shared/types.js';
import { createHttpHandler } from './http.js';
import { createWsHandlers, type WsData } from './ws.js';
import { cleanupAll as cleanupDrops, defaultDropStorage, type DropStorage } from './file-drop.js';
import { RemoteAgentManager } from './remote-agent-manager.js';
import { RemoteTmuxWebManager, parseRemoteHttpBaseUrls } from './remote-tmux-web.js';
import {
  decodePtyBytes,
  encodeFrame,
  encodePtyBytes,
  FrameDecoder,
  type StdioFrame,
} from './stdio-protocol.js';
import type { TmuxControl } from './tmux-control.js';
import { embeddedAssets } from './assets-embedded.js';

export interface StdioAgentOptions {
  input: EventEmitter;
  write: (buf: Buffer) => unknown;
  tmuxControl: TmuxControl;
  version: string;
  tmuxBin?: string;
  tmuxConfPath?: string;
  sessionsStorePath?: string;
  settingsStorePath?: string;
  projectRoot?: string;
  isCompiled?: boolean;
  htmlTemplate?: string;
  distDir?: string;
  themesUserDir?: string;
  themesBundledDir?: string;
  dropStorage?: DropStorage;
  fetch?: typeof fetch;
  webSocketFactory?: (url: string) => WebSocket;
  serverFactory?: () => Promise<AgentServer>;
}

export interface AgentServer {
  baseUrl: string;
  close(): Promise<void>;
}

interface Channel {
  id: string;
  ws: WebSocket;
  opened: boolean;
  pending: string[];
}

export function eventInputFromNodeReadable(input: NodeJS.ReadableStream): EventEmitter {
  const emitter = new EventEmitter();
  input.on('data', chunk => emitter.emit('data', Buffer.from(chunk)));
  input.on('end', () => emitter.emit('end'));
  input.on('error', err => emitter.emit('error', err));
  return emitter;
}

function stdioAgentConfig(tmuxBin: string): ServerConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowedIps: new Set(LOCALHOST_IPS),
    allowedOrigins: [],
    tls: false,
    tmuxBin,
    testMode: false,
    debug: false,
    exposeClientAuth: false,
    auth: {
      enabled: false,
      username: userInfo().username,
      password: undefined,
    },
  };
}

async function readHtmlTemplate(opts: StdioAgentOptions, projectRoot: string): Promise<string> {
  if (opts.htmlTemplate !== undefined) return opts.htmlTemplate;
  const embeddedHtmlPath = embeddedAssets['src/client/index.html'];
  if (embeddedHtmlPath) return Bun.file(embeddedHtmlPath).text();
  const htmlPath = path.join(projectRoot, 'src/client/index.html');
  try {
    return await Bun.file(htmlPath).text();
  } catch {
    return '';
  }
}

async function startLoopbackServer(opts: StdioAgentOptions): Promise<AgentServer> {
  const projectRoot = opts.projectRoot ?? path.resolve(import.meta.dir, '../..');
  const config = stdioAgentConfig(opts.tmuxBin ?? 'tmux');
  const sessionsStorePath = opts.sessionsStorePath
    ?? path.join(process.env.XDG_CONFIG_HOME || path.join(process.env.HOME ?? '', '.config'), 'tmux-web', 'sessions.json');
  const settingsStorePath = opts.settingsStorePath
    ?? path.join(path.dirname(sessionsStorePath), 'settings.json');
  const themesUserDir = opts.themesUserDir
    ?? path.join(path.dirname(sessionsStorePath), 'themes');
  const themesBundledDir = opts.themesBundledDir
    ?? path.join(projectRoot, 'themes');
  const distDir = opts.distDir ?? path.join(projectRoot, 'dist');
  const dropStorage = opts.dropStorage ?? defaultDropStorage();
  const stdioRemoteAgentManager = new RemoteAgentManager();
  const remoteAgentManager = new RemoteTmuxWebManager({
    directHttpBaseUrls: parseRemoteHttpBaseUrls(process.env.TMUX_WEB_REMOTE_URLS),
    stdioManager: stdioRemoteAgentManager,
  });
  const tmuxConfPath = opts.tmuxConfPath ?? path.join(projectRoot, 'tmux.conf');
  const htmlTemplate = await readHtmlTemplate(opts, projectRoot);

  const handler = await createHttpHandler({
    config,
    htmlTemplate,
    distDir,
    themesUserDir,
    themesBundledDir,
    projectRoot,
    isCompiled: opts.isCompiled,
    sessionsStorePath,
    settingsStorePath,
    dropStorage,
    tmuxControl: opts.tmuxControl,
    remoteAgentManager,
  });
  const ws = createWsHandlers({
    config,
    tmuxConfPath,
    sessionsStorePath,
    tmuxControl: opts.tmuxControl,
    remoteAgentManager,
  });

  const server = Bun.serve<WsData, never>({
    hostname: '127.0.0.1',
    port: 0,
    fetch(req, srv) {
      const url = new URL(req.url);
      if (url.pathname.startsWith('/ws') || req.headers.get('upgrade')?.toLowerCase() === 'websocket') {
        const rejected = ws.upgrade(req, srv);
        if (rejected) return rejected;
        return undefined;
      }
      return handler(req, srv);
    },
    error() {
      return new Response('Internal Server Error', { status: 500 });
    },
    websocket: ws.websocket,
  });

  return {
    baseUrl: `http://${server.hostname}:${server.port}`,
    async close() {
      try { ws.close(); } catch { /* best-effort */ }
      try { await remoteAgentManager.close(); } catch { /* best-effort */ }
      server.stop(true);
      try { await cleanupDrops(dropStorage); } catch { /* best-effort */ }
    },
  };
}

function responseBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get('content-type') ?? '';
  if (contentType.toLowerCase().includes('application/json')) return response.json();
  return response.text();
}

function isSessionInfoArray(value: unknown): value is Array<{ id: string; name: string; windows?: number; running?: boolean }> {
  return Array.isArray(value) && value.every(entry => (
    entry
    && typeof entry === 'object'
    && typeof (entry as { id?: unknown }).id === 'string'
    && typeof (entry as { name?: unknown }).name === 'string'
    && (
      (entry as { windows?: unknown }).windows === undefined
      || typeof (entry as { windows?: unknown }).windows === 'number'
    )
    && (
      (entry as { running?: unknown }).running === undefined
      || typeof (entry as { running?: unknown }).running === 'boolean'
    )
  ));
}

export function runStdioAgent(opts: StdioAgentOptions): { close: () => void } {
  const decoder = new FrameDecoder();
  const channels = new Map<string, Channel>();
  const fetchImpl = opts.fetch ?? fetch;
  const webSocketFactory = opts.webSocketFactory ?? ((url: string) => new WebSocket(url));
  let closed = false;
  let serverPromise: Promise<AgentServer> | null = null;
  let server: AgentServer | null = null;

  const send = (frame: StdioFrame): void => {
    try {
      opts.write(encodeFrame(frame));
    } catch {
      closeAll();
    }
  };

  const getServer = async (): Promise<AgentServer> => {
    if (!serverPromise) {
      serverPromise = (opts.serverFactory ?? (() => startLoopbackServer(opts)))().then(started => {
        server = started;
        return started;
      });
    }
    return serverPromise;
  };

  const closeChannel = (channelId: string, reason = 'channel closed'): void => {
    const channel = channels.get(channelId);
    if (!channel) return;
    channels.delete(channelId);
    try { channel.ws.close(1000, reason); } catch { /* best-effort */ }
  };

  function closeAll(): void {
    if (closed) return;
    closed = true;
    for (const id of [...channels.keys()]) closeChannel(id, 'agent closed');
    void server?.close();
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

  const sendChannelError = (channelId: string, code: string, message: string): void => {
    send({ v: 1, type: 'channel-error', channelId, code, message });
  };

  const sendToRemoteWs = (channel: Channel, data: string): void => {
    if (!channel.opened) {
      channel.pending.push(data);
      return;
    }
    channel.ws.send(data);
  };

  const open = async (frame: Extract<StdioFrame, { type: 'open' }>): Promise<void> => {
    if (channels.has(frame.channelId)) {
      closeChannel(frame.channelId, 'channel replaced');
    }

    try {
      const started = await getServer();
      if (closed) return;
      const url = new URL('/ws', started.baseUrl);
      url.searchParams.set('session', frame.session);
      url.searchParams.set('cols', String(frame.cols));
      url.searchParams.set('rows', String(frame.rows));
      const remoteWs = webSocketFactory(url.href);
      const channel: Channel = {
        id: frame.channelId,
        ws: remoteWs,
        opened: false,
        pending: [],
      };
      channels.set(frame.channelId, channel);

      remoteWs.binaryType = 'arraybuffer';
      remoteWs.addEventListener('open', () => {
        if (channels.get(frame.channelId) !== channel || closed) return;
        channel.opened = true;
        send({ v: 1, type: 'open-ok', channelId: frame.channelId, session: frame.session });
        const pending = channel.pending.splice(0);
        for (const msg of pending) remoteWs.send(msg);
      });
      remoteWs.addEventListener('message', (event) => {
        if (channels.get(frame.channelId) !== channel || closed) return;
        const data = typeof event.data === 'string'
          ? Buffer.from(event.data, 'utf8')
          : Buffer.from(event.data as ArrayBuffer);
        send(encodePtyBytes(frame.channelId, data, 'pty-out'));
      });
      remoteWs.addEventListener('close', (event) => {
        if (channels.get(frame.channelId) !== channel) return;
        channels.delete(frame.channelId);
        send({ v: 1, type: 'close', channelId: frame.channelId, reason: event.reason || 'remote websocket closed' });
      });
      remoteWs.addEventListener('error', () => {
        if (channels.get(frame.channelId) !== channel) return;
        sendChannelError(frame.channelId, 'remote-websocket-error', 'remote websocket error');
      });
    } catch (err) {
      sendChannelError(frame.channelId, 'remote-open-failed', err instanceof Error ? err.message : String(err));
    }
  };

  const handleApiGet = async (frame: Extract<StdioFrame, { type: 'api-get' }>): Promise<void> => {
    try {
      if (!frame.path.startsWith('/')) {
        send({ v: 1, type: 'api-response', requestId: frame.requestId, status: 400, body: 'Bad Request' });
        return;
      }
      const started = await getServer();
      const url = new URL(frame.path, started.baseUrl);
      if (url.origin !== started.baseUrl) {
        send({ v: 1, type: 'api-response', requestId: frame.requestId, status: 400, body: 'Bad Request' });
        return;
      }
      const response = await fetchImpl(url.href);
      send({
        v: 1,
        type: 'api-response',
        requestId: frame.requestId,
        status: response.status,
        body: await responseBody(response),
      });
    } catch (err) {
      send({
        v: 1,
        type: 'api-error',
        requestId: frame.requestId,
        code: 'api-get-failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const handleListSessions = async (frame: Extract<StdioFrame, { type: 'list-sessions' }>): Promise<void> => {
    try {
      const started = await getServer();
      const response = await fetchImpl(new URL('/api/sessions', started.baseUrl).href);
      const body = await responseBody(response);
      if (response.status !== 200 || !isSessionInfoArray(body)) {
        throw new Error(`remote /api/sessions returned ${response.status}`);
      }
      send({ v: 1, type: 'sessions', requestId: frame.requestId, sessions: body });
    } catch (err) {
      send({
        v: 1,
        type: 'sessions-error',
        requestId: frame.requestId,
        code: 'api-sessions-failed',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  };

  const onFrame = (frame: StdioFrame): void => {
    switch (frame.type) {
      case 'hello':
        send({ v: 1, type: 'hello-ok', agentVersion: opts.version });
        return;
      case 'open':
        void open(frame);
        return;
      case 'pty-in': {
        const channel = channels.get(frame.channelId);
        if (!channel) return;
        sendToRemoteWs(channel, decodePtyBytes(frame).toString('utf8'));
        return;
      }
      case 'resize': {
        const channel = channels.get(frame.channelId);
        if (!channel) return;
        sendToRemoteWs(channel, JSON.stringify({ type: 'resize', cols: frame.cols, rows: frame.rows }));
        return;
      }
      case 'client-msg': {
        const channel = channels.get(frame.channelId);
        if (!channel) return;
        sendToRemoteWs(channel, frame.data);
        return;
      }
      case 'list-sessions':
        void handleListSessions(frame);
        return;
      case 'api-get':
        void handleApiGet(frame);
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
