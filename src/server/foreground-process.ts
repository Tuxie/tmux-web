import fs from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

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

/** Find the process currently in the foreground of the given tmux session's
 *  active pane. Works by asking tmux for the pane's shell pid, reading that
 *  shell's /proc/<pid>/stat to get the tty foreground pgid (the tpgid field
 *  — the same thing `tcgetpgrp` on the pane's tty returns), then resolving
 *  /proc/<tpgid>/exe to an absolute path. */
export async function getForegroundProcess(
  tmuxBin: string,
  session: string,
): Promise<ForegroundProcessInfo> {
  let panePid: string | null = null;
  let commandName: string | null = null;
  try {
    const { stdout } = await execFileAsync(
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

  // Parse /proc/<panePid>/stat → tpgid (the tty's current foreground pgid).
  // `comm` may contain spaces/parens, so we anchor on the last ')' before
  // splitting the remaining space-separated fields. tpgid is the 5th field
  // after the closing paren (state ppid pgrp session tty_nr tpgid ...).
  let foregroundPid: number | null = null;
  try {
    const stat = fs.readFileSync(`/proc/${panePid}/stat`, 'utf8');
    const closeParen = stat.lastIndexOf(')');
    if (closeParen !== -1) {
      const tail = stat.slice(closeParen + 2).split(' ');
      // tail[0]=state, [1]=ppid, [2]=pgrp, [3]=session, [4]=tty_nr, [5]=tpgid
      const tpgid = Number(tail[5]);
      if (Number.isFinite(tpgid) && tpgid > 0) foregroundPid = tpgid;
    }
  } catch {
    return { exePath: null, commandName, pid: Number(panePid) };
  }

  if (!foregroundPid) {
    // tpgid == -1 or 0 means no foreground process — the pane is idle in the
    // shell with job control disabled, or the shell itself is the foreground.
    foregroundPid = Number(panePid);
  }

  try {
    const exePath = fs.readlinkSync(`/proc/${foregroundPid}/exe`);
    return { exePath, commandName, pid: foregroundPid };
  } catch {
    return { exePath: null, commandName, pid: foregroundPid };
  }
}
