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

if (process.platform === 'darwin') {
  run(['make', 'vendor-tmux']);
  run(['bun', 'run', 'scripts/generate-assets.ts'], {
    ...process.env,
    TMUX_WEB_EMBED_TMUX: '0',
  });
  run([
    'bun',
    'build',
    'src/server/index.ts',
    '--compile',
    '--minify',
    '--sourcemap',
    '--bytecode',
    '--outfile',
    'tmux-web',
  ]);
} else {
  run(['make', 'tmux-web']);
}
