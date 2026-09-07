import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

class FakeWebSocket extends EventEmitter {
  send() {}
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

const { BluffedClient, TableError } = await import('../src/client.js');

describe('BluffedClient does not crash on a table-error frame with no error listener attached', () => {
  it('used to throw synchronously — EventEmitter special-cases "error" with zero listeners', async () => {
    // Mirrors runForever's between-hands window: playOneHand attaches and
    // detaches its own 'error' listener per hand, so nothing is listening
    // while the loop is off awaiting getAgentStatus/fund/sweep.
    const client = new BluffedClient({ apiKey: 'key' });
    const connectPromise = client.connect();
    lastSocket.emit('open');
    await connectPromise;

    expect(client.listenerCount('error')).toBeGreaterThan(0);
    expect(() => {
      lastSocket.emit('message', JSON.stringify({ type: 'error', error: 'some_table_error' }));
    }).not.toThrow();
  });

  it('still delivers the error to a caller that is listening', async () => {
    const client = new BluffedClient({ apiKey: 'key' });
    const connectPromise = client.connect();
    lastSocket.emit('open');
    await connectPromise;

    const received = [];
    client.on('error', (e) => received.push(e));
    lastSocket.emit('message', JSON.stringify({ type: 'error', error: 'some_table_error' }));

    expect(received).toHaveLength(1);
    expect(received[0]).toBeInstanceOf(TableError);
    expect(received[0].code).toBe('some_table_error');
  });
});
