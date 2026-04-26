function run(cmd: string[], env: NodeJS.ProcessEnv = process.env): void {
  const result = Bun.spawnSync(cmd, {
    stdio: ['inherit', 'inherit', 'inherit'],
    env,
  });
  if (result.exitCode !== 0) {
    throw new Error(`${cmd.join(' ')} failed with exit code ${result.exitCode}`);
  }
}

run(['bun', 'run', 'bun-build.ts']);
run(['make', 'tmux-web']);
