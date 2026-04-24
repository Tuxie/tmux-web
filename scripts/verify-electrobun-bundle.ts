import fs from 'node:fs';
import path from 'node:path';

const buildRoot = path.resolve(process.argv[2] ?? 'build');
const expected = path.join(buildRoot, 'dev-linux-x64', 'tmux-term-dev', 'Resources', 'app', 'tmux-web');

if (!fs.existsSync(expected)) {
  console.error(`tmux-term bundle is missing tmux-web binary: ${expected}`);
  process.exit(1);
}

const mode = fs.statSync(expected).mode;
if ((mode & 0o111) === 0) {
  console.error(`tmux-term bundled tmux-web is not executable: ${expected}`);
  process.exit(1);
}

console.log(`Verified tmux-term bundle contains executable tmux-web: ${expected}`);
