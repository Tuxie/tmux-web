import { execFile } from 'node:child_process';

const EXEC_FILE_TIMEOUT_MS = 5000;

/**
 * Promisified execFile with a default 5 s timeout. All tmux subcommands
 * should finish in milliseconds; 5 s is slack for a cold start or a very
 * busy machine, but still finite so a hung tmux can't hold an HTTP or WS
 * handler open indefinitely.
 *
 * Always resolves with string stdout/stderr (encoding: 'utf8' implicit).
 */
export function execFileAsync(
  file: string,
  args: readonly string[],
  opts?: { timeout?: number; env?: NodeJS.ProcessEnv },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', timeout: EXEC_FILE_TIMEOUT_MS, ...opts },
      (err, stdout, stderr) => {
        if (err) reject(err);
        else resolve({ stdout: stdout as string, stderr: stderr as string });
      },
    );
  });
}
