import { createServer, type AddressInfo } from 'node:net';

export async function resolveListenPort(hostname: string, port: number): Promise<number> {
  if (port !== 0) return port;

  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, hostname, () => {
      const address = probe.address() as AddressInfo;
      probe.close();
      resolve(address.port);
    });
  });
}

type ServeOptions<WsData, Route extends string> = Parameters<typeof Bun.serve<WsData, Route>>[0];
type ServeResult<WsData, Route extends string> = ReturnType<typeof Bun.serve<WsData, Route>>;

export async function serveWithResolvedPort<WsData, Route extends string>(
  hostname: string,
  port: number,
  buildOptions: (port: number) => ServeOptions<WsData, Route>,
  attempts = 10,
): Promise<ServeResult<WsData, Route>> {
  let lastListenError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const listenPort = await resolveListenPort(hostname, port);
    try {
      return Bun.serve<WsData, Route>(buildOptions(listenPort));
    } catch (error) {
      if (port !== 0 || (error as { code?: string }).code !== 'EADDRINUSE') throw error;
      lastListenError = error;
    }
  }
  throw lastListenError ?? new Error(`failed to bind ${hostname}:${port}`);
}
