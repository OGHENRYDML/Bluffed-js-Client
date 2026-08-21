import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

// The ping handler lives inside connect()'s own message listener, not
// anywhere reachable by stubbing client.ws after the fact (every other
// client.js test does that, since none of them needed the real message
// handler) — so this one actually has to drive connect() through a faked
// 'ws' module.
class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.sent = [];
  }
  send(data) {
    this.sent.push(JSON.parse(data));
  }
  close() {}
  terminate() {}
}

let lastSocket;
vi.mock('ws', () => ({
  default: class {
    constructor() {
      lastSocket = new FakeWebSocket();
      return lastSocket;
    }
  }
}));

const { BluffedClient } = await import('../src/client.js');

describe('BluffedClient answers a server ping with a pong', () => {
  it('replies to a ping without surfacing it as a state or error event', async () => {
    const client = new BluffedClient({ apiKey: 'key' });
    const states = [];
    const errors = [];
    client.on('state', (s) => states.push(s));
    client.on('error', (e) => errors.push(e));

    const connectPromise = client.connect();
    lastSocket.emit('open');
    await connectPromise;

    lastSocket.emit('message', JSON.stringify({ type: 'ping' }));

    expect(lastSocket.sent).toContainEqual({ type: 'pong' });
    expect(states).toEqual([]);
    expect(errors).toEqual([]);
  });
});
