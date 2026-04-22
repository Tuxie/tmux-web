/* tmux control-mode (`tmux -C`) client pool: parser, per-session
 * ControlClient, oldest-alive primary election, serial command queue,
 * notification dispatch. Consumed by http.ts / ws.ts / foreground-process.ts
 * / tmux-inject.ts / osc52-reply.ts to replace execFileAsync fork-per-op. */

export type RunCmd = (args: readonly string[]) => Promise<string>;

export type TmuxNotification =
  | { type: 'sessionsChanged' }
  | { type: 'sessionRenamed'; id: string; name: string }
  | { type: 'sessionClosed'; id: string }
  | { type: 'windowAdd'; window: string }
  | { type: 'windowClose'; window: string }
  | { type: 'windowRenamed'; window: string; name: string };

export class TmuxCommandError extends Error {
  constructor(
    public args: readonly string[],
    public stderr: string,
    public exitCode?: number,
  ) { super(stderr); this.name = 'TmuxCommandError'; }
}

export class NoControlClientError extends Error {
  constructor() { super('no control client available'); this.name = 'NoControlClientError'; }
}

export interface ParserCallbacks {
  onResponse: (cmdnum: number, output: string) => void;
  onError: (cmdnum: number, stderr: string) => void;
  onNotification: (n: TmuxNotification) => void;
}

export class ControlParser {
  private buf = '';
  private inEnvelope: { cmdnum: number; lines: string[] } | null = null;

  constructor(private cb: ParserCallbacks) {}

  push(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, nl);
      this.buf = this.buf.slice(nl + 1);
      this.consumeLine(line);
    }
  }

  private consumeLine(line: string): void {
    if (this.inEnvelope) {
      if (line.startsWith('%end ')) {
        const parts = line.split(' ');
        const cmdnum = Number(parts[2]);
        this.cb.onResponse(cmdnum, this.inEnvelope.lines.join('\n'));
        this.inEnvelope = null;
        return;
      }
      if (line.startsWith('%error ')) {
        const parts = line.split(' ');
        const cmdnum = Number(parts[2]);
        this.cb.onError(cmdnum, this.inEnvelope.lines.join('\n'));
        this.inEnvelope = null;
        return;
      }
      this.inEnvelope.lines.push(line);
      return;
    }
    if (line.startsWith('%begin ')) {
      const parts = line.split(' ');
      this.inEnvelope = { cmdnum: Number(parts[2]), lines: [] };
      return;
    }
    // Outside an envelope: notification or unknown line.
    if (!line.startsWith('%')) return;
    const note = parseNotification(line);
    if (note) this.cb.onNotification(note);
  }
}

/** Parse a standalone tmux control-mode notification line into a
 *  TmuxNotification. Returns null for recognised-but-ignored events
 *  (%output, %client-session-changed, %layout-change, …) and for
 *  unknown event names. */
export function parseNotification(line: string): TmuxNotification | null {
  // Quick escape for %output — the highest-volume notification and the
  // one we explicitly discard (B does not consume control-mode output).
  if (line.startsWith('%output ')) return null;
  const sp = line.indexOf(' ');
  const head = sp >= 0 ? line.slice(0, sp) : line;
  const rest = sp >= 0 ? line.slice(sp + 1) : '';
  switch (head) {
    case '%sessions-changed':
      return { type: 'sessionsChanged' };
    case '%session-renamed': {
      const sp2 = rest.indexOf(' ');
      if (sp2 < 0) return null;
      return { type: 'sessionRenamed', id: rest.slice(0, sp2), name: rest.slice(sp2 + 1) };
    }
    case '%session-closed':
      return { type: 'sessionClosed', id: rest.trim() };
    case '%window-add':
      return { type: 'windowAdd', window: rest.trim() };
    case '%window-close':
      return { type: 'windowClose', window: rest.trim() };
    case '%window-renamed': {
      const sp2 = rest.indexOf(' ');
      if (sp2 < 0) return null;
      return { type: 'windowRenamed', window: rest.slice(0, sp2), name: rest.slice(sp2 + 1) };
    }
    default:
      return null;
  }
}

export interface TmuxControl {
  attachSession(session: string): Promise<void>;
  detachSession(session: string): void;
  run: RunCmd;
  on<T extends TmuxNotification['type']>(
    event: T,
    cb: (n: Extract<TmuxNotification, { type: T }>) => void,
  ): () => void;
  close(): Promise<void>;
}
