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
      entrypoint: 'src/desktop/index.ts',
      external: ['electrobun/bun'],
    },
    copy: {
      'tmux-web': 'tmux-web',
    },
    mac: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      chromiumFlags: {
        'disable-gpu': false,
      },
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: 'cef',
      chromiumFlags: {
        'disable-gpu': false,
      },
    },
  },
  scripts: {
    postBuild: 'scripts/prepare-electrobun-bundle.ts',
  },
} satisfies ElectrobunConfig;
