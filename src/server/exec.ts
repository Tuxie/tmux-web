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
  const timeoutMs = opts?.timeout ?? EXEC_FILE_TIMEOUT_MS;
  let proc: Bun.Subprocess<'ignore', 'pipe', 'pipe'>;
  try {
    proc = Bun.spawn([file, ...args], {
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      env: opts?.env,
    });
  } catch (err) {
    return Promise.reject(err);
  }

  let killTimer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    killTimer = setTimeout(() => {
      try { proc.kill('SIGTERM'); } catch {}
      setTimeout(() => {
        try { proc.kill('SIGKILL'); } catch {}
      }, 500);
      reject(new Error(`${file} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  const completion = Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]).then(([stdout, stderr, exitCode]) => {
    if (exitCode !== 0) {
      throw new Error(stderr || `${file} exited with status ${exitCode}`);
    }
    return { stdout, stderr };
  });

  return Promise.race([completion, timeout]).finally(() => {
    if (killTimer) clearTimeout(killTimer);
  });
}
