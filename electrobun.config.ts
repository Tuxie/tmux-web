import type { ElectrobunConfig } from 'electrobun';
import pkg from './package.json' with { type: 'json' };

export default {
  app: {
    name: 'tmux-term',
    identifier: 'dev.tmux-web.tmux-term',
    version: pkg.version,
  },
  runtime: {
    exitOnLastWindowClosed: true,
  },
  build: {
    bun: {
      entrypoint: 'src/desktop/app.ts',
      external: ['electrobun/bun'],
    },
    mac: {
      bundleCEF: false,
      defaultRenderer: 'native',
    },
    linux: {
      bundleCEF: false,
      defaultRenderer: 'native',
    },
  },
} satisfies ElectrobunConfig;
