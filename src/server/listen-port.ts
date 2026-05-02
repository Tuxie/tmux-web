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
