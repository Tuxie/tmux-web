import { encodeFrame, encodePtyBytes, FrameDecoder, type StdioFrame } from './stdio-protocol.js';

export interface AgentProc {
  stdin: { write(data: Buffer): unknown; flush?(): unknown; end(): unknown };
  stdout: { on(event: 'data', cb: (chunk: Buffer | Uint8Array) => void): unknown };
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

type FrameListener = (frame: StdioFrame) => void;

export class RemoteChannel {
  readonly channelId: string;
  private readonly writeFrame: (frame: StdioFrame) => void;
  private readonly frameListeners: FrameListener[] = [];
  private closed = false;

  constructor(channelId: string, writeFrame: (frame: StdioFrame) => void) {
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
  }

  markRemoteClosed(): void {
    this.closed = true;
  }
}

export class RemoteHostAgent {
  private readonly host: string;
  private readonly proc: AgentProc;
  private readonly decoder = new FrameDecoder();
  private readonly pendingOpens = new Map<string, PendingOpen>();
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
    private readonly onDone: (agent: RemoteHostAgent) => void = () => {},
  ) {
    this.host = host;
    this.proc = proc;
    this.ready = new Promise<RemoteHostAgent>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });

    proc.stdout.on('data', chunk => this.handleChunk(chunk));
    proc.exited.then(
      () => this.handleExit(),
      err => this.handleExit(err),
    );
    this.writeFrame({ v: 1, type: 'hello' });
  }

  openChannel(opts: OpenChannelOptions): Promise<RemoteChannel> {
    const channelId = crypto.randomUUID();
    const channel = new RemoteChannel(channelId, frame => this.writeFrame(frame));
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

  close(): void {
    this.writeFrame({ v: 1, type: 'shutdown' });
    this.teardown();
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
      case 'open-ok': {
        const pending = this.pendingOpens.get(frame.channelId);
        if (!pending) return;
        this.pendingOpens.delete(frame.channelId);
        this.channels.set(frame.channelId, pending.channel);
        pending.resolve(pending.channel);
        return;
      }
      case 'channel-error': {
        const pending = this.pendingOpens.get(frame.channelId);
        if (pending) {
          this.pendingOpens.delete(frame.channelId);
          pending.reject(new Error(`remote channel ${frame.channelId} error: ${frame.code}: ${frame.message}`));
          return;
        }
        this.channels.get(frame.channelId)?.emit('frame', frame);
        return;
      }
      case 'close': {
        const channel = this.channels.get(frame.channelId);
        if (channel) {
          channel.markRemoteClosed();
          channel.emit('frame', frame);
          this.channels.delete(frame.channelId);
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
    for (const channel of this.channels.values()) {
      channel.emit('frame', { v: 1, type: 'close', channelId: channel.channelId, reason: String(reason) });
      channel.markRemoteClosed();
    }
    this.channels.clear();
  }

  private handleExit(err?: unknown): void {
    this.tornDown = true;
    this.rejectAll(err ?? new Error(`remote host ${this.host} agent exited`));
    this.onDone(this);
  }
}

export class RemoteAgentManager {
  private readonly spawn: (host: string) => AgentProc;
  private readonly idleTimeoutMs: number;
  private readonly agents = new Map<string, RemoteHostAgent>();

  constructor(opts: RemoteAgentManagerOptions = {}) {
    this.spawn = opts.spawn ?? spawnSshAgent;
    this.idleTimeoutMs = opts.idleTimeoutMs ?? 60_000;
  }

  getHost(host: string): Promise<RemoteHostAgent> {
    let agent = this.agents.get(host);
    if (!agent) {
      agent = new RemoteHostAgent(host, this.spawn(host), this.idleTimeoutMs, closedAgent => {
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
    for (const agent of agents) {
      agent.close();
    }
    await Promise.allSettled(agents.map(agent => agent.ready));
  }
}

function spawnSshAgent(host: string): AgentProc {
  const proc = Bun.spawn(['ssh', '-T', host, 'tmux-web', '--stdio-agent'], {
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
  (async () => {
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
  return { on: (_event, cb) => { listeners.push(cb); } };
}
