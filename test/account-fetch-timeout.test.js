import { createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { AccountClient, AccountError } from '../src/account.js';

describe('AccountClient fetch timeout', () => {
  let server;
  let sockets;

  afterEach(async () => {
    if (!server) return;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  });

  it('rejects instead of hanging forever when the server never answers', async () => {
    // fetch() has no default timeout — a server that accepts the connection
    // but never responds (a stalled Worker, a dropped route) would otherwise
    // leave every AccountClient call (sign-in, balance, fund, sweep, ...)
    // pending forever with nothing to catch or retry.
    sockets = [];
    server = createServer((socket) => {
      sockets.push(socket);
      socket.on('error', () => {});
    });
    const port = await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });

    const account = new AccountClient(`http://127.0.0.1:${port}`, { timeoutMs: 50 });

    await expect(account.balance()).rejects.toThrow(AccountError);
  });
});
