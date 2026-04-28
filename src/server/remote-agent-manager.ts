import { encodeFrame, encodePtyBytes, FrameDecoder, type StdioFrame } from './stdio-protocol.js';

interface AgentReadable {
  on(event: 'data', cb: (chunk: Buffer | Uint8Array) => void): unknown;
  closed?: Promise<unknown>;
}

export interface AgentProc {
  stdin: { write(data: Buffer): unknown; flush?(): unknown; end(): unknown };
  stdout: AgentReadable;
  stderr?: AgentReadable;
  exited: Promise<unknown>;
  kill(): unknown;
}

export interface RemoteAgentManagerOptions {
  spawn?: (host: string) => AgentProc;
  idleTimeoutMs?: number;
}

export interface OpenChannelOptions {
  session: string;
  cols: number;
  rows: number;
}

interface PendingOpen {
  channel: RemoteChannel;
  resolve: (channel: RemoteChannel) => void;
  reject: (err: unknown) => void;
}

interface PendingListSessions {
  resolve: (sessions: Array<{ id: string; name: string; windows?: number; running?: boolean }>) => void;
  reject: (err: unknown) => void;
}

interface PendingApiGet {
  resolve: (response: { status: number; body: unknown }) => void;
  reject: (err: unknown) => void;
}

type FrameListener = (frame: StdioFrame) => void;

export class RemoteChannel {
  readonly channelId: string;
  private readonly writeFrame: (frame: StdioFrame) => void;
  private readonly frameListeners: FrameListener[] = [];
  private closed = false;

  constructor(
    channelId: string,
    writeFrame: (frame: StdioFrame) => void,
    private readonly onLocalClose: () => void = () => {},
  ) {
    this.channelId = channelId;
    this.writeFrame = writeFrame;
  }

  on(event: 'frame', cb: FrameListener): () => void {
    this.frameListeners.push(cb);
    return () => {
      const idx = this.frameListeners.indexOf(cb);
      if (idx !== -1) this.frameListeners.splice(idx, 1);
    };
  }

  emit(_event: 'frame', frame: StdioFrame): void {
    for (const cb of [...this.frameListeners]) {
      cb(frame);
    }
  }

  sendPty(data: string): void {
    if (this.closed) return;
    this.writeFrame(encodePtyBytes(this.channelId, Buffer.from(data, 'utf8'), 'pty-in'));
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.writeFrame({ v: 1, type: 'resize', channelId: this.channelId, cols, rows });
  }

  sendClientMessage(data: string): void {
    if (this.closed) return;
    this.writeFrame({ v: 1, type: 'client-msg', channelId: this.channelId, data });
  }

  close(reason = 'local close'): void {
    if (this.closed) return;
    this.closed = true;
    this.writeFrame({ v: 1, type: 'close', channelId: this.channelId, reason });
    this.onLocalClose();
  }

  markRemoteClosed(): void {
    this.closed = true;
  }
}

export class RemoteHostAgent {
  private readonly host: string;
  private readonly proc: AgentProc;
  private readonly decoder = new FrameDecoder();
  private stderr = '';
  private readonly pendingOpens = new Map<string, PendingOpen>();
  private readonly pendingListSessions = new Map<string, PendingListSessions>();
  private readonly pendingApiGets = new Map<string, PendingApiGet>();
  private readonly channels = new Map<string, RemoteChannel>();
  private readyResolve!: (agent: RemoteHostAgent) => void;
  private readyReject!: (err: unknown) => void;
  private readySettled = false;
  private tornDown = false;
  readonly ready: Promise<RemoteHostAgent>;

  constructor(
    host: string,
    proc: AgentProc,
    readonly idleTimeoutMs: number,
    private readonly onActivity: (agent: RemoteHostAgent) => void = () => {},
    private readonly onIdle: (agent: RemoteHostAgent) => void = () => {},
    private readonly onDone: (agent: RemoteHostAgent) => void = () => {},
  ) {
    this.host = host;
    this.proc = proc;
    this.ready = new Promise<RemoteHostAgent>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    proc.stdout.on('data', chunk => this.handleChunk(chunk));
    proc.stderr?.on('data', chunk => this.captureStderr(chunk));
    proc.exited.then(
      () => { void this.handleExit(); },
      err => { void this.handleExit(err); },
    );
    this.writeFrame({ v: 1, type: 'hello' });
  }

  openChannel(opts: OpenChannelOptions): Promise<RemoteChannel> {
    this.onActivity(this);
    const channelId = crypto.randomUUID();
    const channel = new RemoteChannel(
      channelId,
      frame => this.writeFrame(frame),
      () => this.markChannelClosed(channelId),
    );
    const opened = new Promise<RemoteChannel>((resolve, reject) => {
      this.pendingOpens.set(channelId, { channel, resolve, reject });
    });
    this.writeFrame({
      v: 1,
      type: 'open',
      channelId,
      session: opts.session,
      cols: opts.cols,
      rows: opts.rows,
    });
    return opened;
  }

  listSessions(): Promise<Array<{ id: string; name: string; windows?: number; running?: boolean }>> {
    this.onActivity(this);
    const requestId = crypto.randomUUID();
    const listed = new Promise<Array<{ id: string; name: string; windows?: number; running?: boolean }>>((resolve, reject) => {
      this.pendingListSessions.set(requestId, { resolve, reject });
    });
    this.writeFrame({ v: 1, type: 'list-sessions', requestId });
    return listed;
  }

  close(): void {
    if (this.tornDown) return;
    this.writeFrame({ v: 1, type: 'shutdown' });
    this.teardown();
  }

  isReadyAndIdle(): boolean {
    return this.readySettled
      && !this.tornDown
      && this.pendingOpens.size === 0
      && this.pendingListSessions.size === 0
      && this.pendingApiGets.size === 0
      && this.channels.size === 0;
  }

  apiGet(path: string): Promise<{ status: number; body: unknown }> {
    this.onActivity(this);
    const requestId = crypto.randomUUID();
    const response = new Promise<{ status: number; body: unknown }>((resolve, reject) => {
      this.pendingApiGets.set(requestId, { resolve, reject });
    });
    this.writeFrame({ v: 1, type: 'api-get', requestId, path });
    return response;
  }

  private teardown(): void {
    if (this.tornDown) return;
    this.tornDown = true;
    try {
      this.proc.stdin.end();
    } catch {
      // Best-effort close; kill below is the authoritative teardown.
    }
    this.proc.kill();
  }

  private handleChunk(chunk: Buffer | Uint8Array): void {
    for (const frame of this.decoder.push(chunk)) {
      this.handleFrame(frame);
    }
  }

  private captureStderr(chunk: Buffer | Uint8Array): void {
    this.stderr += Buffer.from(chunk).toString('utf8');
    if (this.stderr.length > 4096) {
      this.stderr = this.stderr.slice(-4096);
    }
  }

  private handleFrame(frame: StdioFrame): void {
    switch (frame.type) {
      case 'hello-ok':
        this.resolveReady();
        return;
      case 'host-error':
        this.rejectAll(new Error(`remote host ${this.host} error: ${frame.code}: ${frame.message}`));
        this.teardown();
        this.onDone(this);
        return;
      case 'sessions': {
        const pending = this.pendingListSessions.get(frame.requestId);
        if (!pending) return;
        this.pendingListSessions.delete(frame.requestId);
        this.onActivity(this);
        pending.resolve(frame.sessions);
        this.checkIdle();
        return;
      }
      case 'sessions-error': {
        const pending = this.pendingListSessions.get(frame.requestId);
        if (!pending) return;
        this.pendingListSessions.delete(frame.requestId);
        pending.reject(new Error(`remote sessions ${frame.requestId} error: ${frame.code}: ${frame.message}`));
        this.checkIdle();
        return;
      }
      case 'api-response': {
        const pending = this.pendingApiGets.get(frame.requestId);
        if (!pending) return;
        this.pendingApiGets.delete(frame.requestId);
        this.onActivity(this);
        pending.resolve({ status: frame.status, body: frame.body });
        this.checkIdle();
        return;
      }
      case 'api-error': {
        const pending = this.pendingApiGets.get(frame.requestId);
        if (!pending) return;
        this.pendingApiGets.delete(frame.requestId);
        pending.reject(new Error(`remote api ${frame.requestId} error: ${frame.code}: ${frame.message}`));
        this.checkIdle();
        return;
      }
      case 'open-ok': {
        const pending = this.pendingOpens.get(frame.channelId);
        if (!pending) return;
        this.pendingOpens.delete(frame.channelId);
        this.onActivity(this);
        this.channels.set(frame.channelId, pending.channel);
        pending.resolve(pending.channel);
        return;
      }
      case 'channel-error': {
        const pending = this.pendingOpens.get(frame.channelId);
        if (pending) {
          this.pendingOpens.delete(frame.channelId);
          pending.reject(new Error(`remote channel ${frame.channelId} error: ${frame.code}: ${frame.message}`));
          this.checkIdle();
          return;
        }
        const channel = this.channels.get(frame.channelId);
        if (channel) {
          channel.emit('frame', frame);
          this.markChannelClosed(frame.channelId);
          return;
        }
        this.channels.get(frame.channelId)?.emit('frame', frame);
        return;
      }
      case 'close': {
        const channel = this.channels.get(frame.channelId);
        if (channel) {
          channel.emit('frame', frame);
          this.markChannelClosed(frame.channelId);
        }
        return;
      }
      case 'pty-out':
      case 'server-msg':
        this.channels.get(frame.channelId)?.emit('frame', frame);
        return;
      default:
        return;
    }
  }

  private writeFrame(frame: StdioFrame): void {
    this.proc.stdin.write(encodeFrame(frame));
    this.proc.stdin.flush?.();
  }

  private resolveReady(): void {
    if (this.readySettled) return;
    this.readySettled = true;
    this.readyResolve(this);
    this.checkIdle();
  }

  private rejectAll(reason: unknown): void {
    if (!this.readySettled) {
      this.readySettled = true;
      this.readyReject(reason);
    }
    for (const pending of this.pendingOpens.values()) {
      pending.reject(reason);
    }
    this.pendingOpens.clear();
    for (const pending of this.pendingListSessions.values()) {
      pending.reject(reason);
    }
    this.pendingListSessions.clear();
    for (const pending of this.pendingApiGets.values()) {
      pending.reject(reason);
    }
    this.pendingApiGets.clear();
    for (const channel of this.channels.values()) {
      channel.emit('frame', { v: 1, type: 'close', channelId: channel.channelId, reason: String(reason) });
      channel.markRemoteClosed();
    }
    this.channels.clear();
  }

  private async handleExit(err?: unknown): Promise<void> {
    await this.proc.stderr?.closed?.catch(() => {});
    this.tornDown = true;
    this.rejectAll(err ?? new Error(this.formatExitMessage()));
    this.onDone(this);
  }

  private formatExitMessage(): string {
    const stderr = this.stderr.trim();
    if (!stderr) return `remote host ${this.host} agent exited`;
    return `remote host ${this.host} agent exited: ${stderr}`;
  }

  private checkIdle(): void {
    if (this.isReadyAndIdle()) {
      this.onIdle(this);
    }
  }

  private markChannelClosed(channelId: string): void {
    const channel = this.channels.get(channelId);
    if (!channel) return;
    channel.markRemoteClosed();
    this.channels.delete(channelId);
    this.checkIdle();
  }
}

export class RemoteAgentManager {
  private readonly spawn: (host: string) => AgentProc;
  private readonly idleTimeoutMs: number;
  private readonly agents = new Map<string, RemoteHostAgent>();
  private readonly idleTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(opts: RemoteAgentManagerOptions = {}) {
    this.spawn = opts.spawn ?? spawnSshAgent;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
  }

  getHost(host: string): Promise<RemoteHostAgent> {
    let agent = this.agents.get(host);
    if (!agent) {
      agent = new RemoteHostAgent(host, this.spawn(host), this.idleTimeoutMs, closedAgent => {
        this.cancelIdleTimer(host, closedAgent);
      }, idleAgent => {
        this.scheduleIdleShutdown(host, idleAgent);
      }, closedAgent => {
        this.cancelIdleTimer(host, closedAgent);
        if (this.agents.get(host) === closedAgent) {
          this.agents.delete(host);
        }
      });
      this.agents.set(host, agent);
    }
    return agent.ready;
  }

  async close(): Promise<void> {
    const agents = [...this.agents.values()];
    this.agents.clear();
    for (const host of [...this.idleTimers.keys()]) {
      this.cancelIdleTimer(host);
    }
    for (const agent of agents) {
      agent.close();
    }
    await Promise.allSettled(agents.map(agent => agent.ready));
  }

  private cancelIdleTimer(host: string, agent?: RemoteHostAgent): void {
    if (agent && this.agents.get(host) !== agent) return;
    const timer = this.idleTimers.get(host);
    if (!timer) return;
    clearTimeout(timer);
    this.idleTimers.delete(host);
  }

  private scheduleIdleShutdown(host: string, agent: RemoteHostAgent): void {
    if (this.agents.get(host) !== agent || !agent.isReadyAndIdle() || this.idleTimers.has(host)) return;
    const timer = setTimeout(() => {
      this.idleTimers.delete(host);
      if (this.agents.get(host) !== agent || !agent.isReadyAndIdle()) return;
      this.agents.delete(host);
      agent.close();
    }, this.idleTimeoutMs);
    this.idleTimers.set(host, timer);
  }
}

export function buildSshAgentCommand(host: string): string[] {
  return [
    'ssh',
    '-T',
    '-o',
    'StrictHostKeyChecking=accept-new',
    host,
    'tmux-web',
    '--stdio-agent',
  ];
}

function spawnSshAgent(host: string): AgentProc {
  const proc = Bun.spawn(buildSshAgentCommand(host), {
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'pipe',
  });

  return {
    stdin: {
      write: data => proc.stdin.write(data),
      flush: () => proc.stdin.flush(),
      end: () => proc.stdin.end(),
    },
    stdout: adaptReadable(proc.stdout, () => proc.kill()),
    stderr: adaptReadable(proc.stderr, () => proc.kill()),
    exited: proc.exited,
    kill: () => proc.kill(),
  };
}

function adaptReadable(
  stream: ReadableStream<Uint8Array>,
  onStreamError: () => void,
): AgentProc['stdout'] {
  type DataCb = (chunk: Buffer) => void;
  const listeners: DataCb[] = [];
  const closed = (async () => {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        if (value) {
          for (const cb of listeners) cb(Buffer.from(value));
        }
      }
    } catch {
      onStreamError();
    }
  })();
  return { on: (_event, cb) => { listeners.push(cb); }, closed };
}
