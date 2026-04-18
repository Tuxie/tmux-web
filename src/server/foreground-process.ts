import fs from 'fs';
import { execFileAsync } from './exec.js';

export interface ForegroundProcessInfo {
  /** Kernel-resolved absolute executable path, or null if unreadable
   *  (process may have exited, or we're not on a procfs-equipped OS). */
  exePath: string | null;
  /** Process name as reported by tmux's pane_current_command format. Useful
   *  as a fallback label when exePath is unavailable. */
  commandName: string | null;
  /** PID of the foreground process at the time of the lookup. */
  pid: number | null;
}

export interface ForegroundDeps {
  exec: (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
  readFile: (path: string) => string;
  readlink: (path: string) => string;
}

/** Parse /proc/<pid>/stat → tpgid (the tty's current foreground pgid).
 *  `comm` may contain spaces/parens, so we anchor on the last ')' before
 *  splitting the remaining space-separated fields. tpgid is the 5th field
 *  after the closing paren (state ppid pgrp session tty_nr tpgid ...). */
export function parseForegroundFromProc(stat: string): number | null {
  const closeParen = stat.lastIndexOf(')');
  if (closeParen === -1) return null;
  const tail = stat.slice(closeParen + 2).split(' ');
  const tpgid = Number(tail[5]);
  if (!Number.isFinite(tpgid) || tpgid <= 0) return null;
  return tpgid;
}

const defaultDeps: ForegroundDeps = {
  exec: execFileAsync,
  readFile: (p) => fs.readFileSync(p, 'utf8'),
  readlink: (p) => fs.readlinkSync(p) as string,
};

/** Find the process currently in the foreground of the given tmux session's
 *  active pane. Works by asking tmux for the pane's shell pid, reading that
 *  shell's /proc/<pid>/stat to get the tty foreground pgid, then resolving
 *  /proc/<tpgid>/exe to an absolute path. */
export async function getForegroundProcess(
  tmuxBin: string,
  session: string,
  deps: ForegroundDeps = defaultDeps,
): Promise<ForegroundProcessInfo> {
  let panePid: string | null = null;
  let commandName: string | null = null;
  try {
    const { stdout } = await deps.exec(
      tmuxBin,
      ['display-message', '-p', '-t', session, '-F', '#{pane_pid}\t#{pane_current_command}'],
    );
    const [pidStr, cmdStr] = stdout.trim().split('\t');
    if (pidStr) panePid = pidStr;
    if (cmdStr) commandName = cmdStr;
  } catch {
    return { exePath: null, commandName: null, pid: null };
  }
  if (!panePid) return { exePath: null, commandName, pid: null };

  let foregroundPid: number | null = null;
  try {
    const stat = deps.readFile(`/proc/${panePid}/stat`);
    foregroundPid = parseForegroundFromProc(stat);
  } catch {
    return { exePath: null, commandName, pid: Number(panePid) };
  }
  if (!foregroundPid) foregroundPid = Number(panePid);

  try {
    const exePath = deps.readlink(`/proc/${foregroundPid}/exe`);
    return { exePath, commandName, pid: foregroundPid };
  } catch {
    return { exePath: null, commandName, pid: foregroundPid };
  }
}
