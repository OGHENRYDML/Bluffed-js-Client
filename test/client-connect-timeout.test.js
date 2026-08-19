import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { BluffedClient, BluffedError } from '../src/client.js';

describe('BluffedClient connect timeout', () => {
  let server;
  let sockets;

  afterEach(async () => {
    if (!server) return;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects instead of hanging forever when the server never answers the upgrade', async () => {
    // Reproduces the real bug this guards against: the server accepts the
    // TCP connection but never sends a WebSocket upgrade response at all
    // (e.g. an unreachable table backend) — ws has no built-in timeout for
    // that, so connect() would otherwise never settle.
    sockets = [];
    server = createServer((socket) => {
      sockets.push(socket);
      socket.on('error', () => {});
    });
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });

    const client = new BluffedClient({
      apiKey: 'test',
      baseUrl: `http://127.0.0.1:${port}`,
      tierId: 't_micro',
      connectTimeoutMs: 50
    });

    await expect(client.connect()).rejects.toThrow(BluffedError);
  });
});
