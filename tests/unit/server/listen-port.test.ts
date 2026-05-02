import { describe, expect, test } from 'bun:test';
import { resolveListenPort, serveWithResolvedPort } from '../../../src/server/listen-port.js';

describe('resolveListenPort', () => {
  test('returns fixed ports unchanged', async () => {
    expect(await resolveListenPort('127.0.0.1', 4022)).toBe(4022);
  });

  test('resolves port 0 to a concrete loopback port', async () => {
    const port = await resolveListenPort('127.0.0.1', 0);
    expect(port).toBeGreaterThan(0);
  });
});

describe('serveWithResolvedPort', () => {
  test('starts a server on a resolved loopback port', async () => {
    const server = await serveWithResolvedPort('127.0.0.1', 0, (port) => ({
      hostname: '127.0.0.1',
      port,
      fetch: () => new Response('ok'),
    }));

    try {
      const response = await fetch(`http://127.0.0.1:${server.port}/`);
      expect(response.status).toBe(200);
      expect(await response.text()).toBe('ok');
    } finally {
      server.stop(true);
    }
  });

  test('retries transient port races for dynamic ports', async () => {
    const errors = [Object.assign(new Error('busy'), { code: 'EADDRINUSE' })];
    const builtPorts: number[] = [];
    const servedPorts: number[] = [];
    const server = { port: 1002 } as ReturnType<typeof Bun.serve>;

    const result = await serveWithResolvedPort(
      '127.0.0.1',
      0,
      (port) => {
        builtPorts.push(port);
        return { port, fetch: () => new Response('ok') };
      },
      2,
      {
        resolvePort: async (_hostname, _port) => (builtPorts.length === 0 ? 1001 : 1002),
        serve: (options) => {
          servedPorts.push(options.port);
          const error = errors.shift();
          if (error) throw error;
          return server;
        },
      },
    );

    expect(result).toBe(server);
    expect(builtPorts).toEqual([1001, 1002]);
    expect(servedPorts).toEqual([1001, 1002]);
  });

  test('does not retry fixed port bind failures', async () => {
    const error = Object.assign(new Error('busy'), { code: 'EADDRINUSE' });
    let attempts = 0;

    await expect(
      serveWithResolvedPort(
        '127.0.0.1',
        4022,
        (port) => ({ port, fetch: () => new Response('ok') }),
        2,
        {
          resolvePort: async (_hostname, port) => port,
          serve: () => {
            attempts += 1;
            throw error;
          },
        },
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  test('does not retry non-bind failures', async () => {
    const error = Object.assign(new Error('denied'), { code: 'EACCES' });
    let attempts = 0;

    await expect(
      serveWithResolvedPort(
        '127.0.0.1',
        0,
        (port) => ({ port, fetch: () => new Response('ok') }),
        2,
        {
          resolvePort: async () => 1001,
          serve: () => {
            attempts += 1;
            throw error;
          },
        },
      ),
    ).rejects.toBe(error);
    expect(attempts).toBe(1);
  });

  test('throws the final bind error after retry exhaustion', async () => {
    const errors = [
      Object.assign(new Error('busy 1'), { code: 'EADDRINUSE' }),
      Object.assign(new Error('busy 2'), { code: 'EADDRINUSE' }),
    ];
    let attempts = 0;

    await expect(
      serveWithResolvedPort(
        '127.0.0.1',
        0,
        (port) => ({ port, fetch: () => new Response('ok') }),
        2,
        {
          resolvePort: async () => 1001 + attempts,
          serve: () => {
            attempts += 1;
            throw errors[attempts - 1];
          },
        },
      ),
    ).rejects.toBe(errors[1]);
    expect(attempts).toBe(2);
  });

  test('throws a generic error when no attempts are allowed', async () => {
    await expect(
      serveWithResolvedPort('127.0.0.1', 0, (port) => ({ port, fetch: () => new Response('ok') }), 0),
    ).rejects.toThrow('failed to bind 127.0.0.1:0');
  });
});
