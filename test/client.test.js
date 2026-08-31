import { describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { BluffedClient } from '../src/client.js';

/**
 * The server (poker-table.ts) pings every seat on a cadence to catch
 * connections that die without a close frame; an unanswered ping leads to
 * the player being declared disconnected and eventually evicted. The client
 * must answer each ping with a pong — this test runs a real WebSocket server
 * to prove the full round trip.
 */
describe('BluffedClient ping/pong', () => {
  it('answers a server ping with a pong', async () => {
    const wss = new WebSocketServer({ port: 0 });
    const port = wss.address().port;

    const pong = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('no pong received')), 2000);
      wss.on('connection', (socket) => {
        socket.on('message', (raw) => {
          const msg = JSON.parse(raw.toString());
          if (msg.type === 'pong') {
            clearTimeout(timer);
            resolve(msg);
          }
        });
        socket.send(JSON.stringify({ type: 'ping' }));
      });
    });

    const client = new BluffedClient({ apiKey: 'test-key', baseUrl: `http://localhost:${port}`, tierId: 't_low' });
    try {
      await client.connect();
      const pongMsg = await pong;
      expect(pongMsg).toEqual({ type: 'pong' });
    } finally {
      client.close();
      await new Promise((resolve) => wss.close(resolve));
    }
  });
});
