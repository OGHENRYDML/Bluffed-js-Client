import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/agent-self.js', () => ({
  getAgentStatus: vi.fn(async () => ({ availableMicros: 1_000_000_000 }))
}));

// Mirrors the real BluffedClient: leave() requires a live socket and
// throws otherwise, close() is always safe to call regardless of
// connection state.
class MaybeDisconnectedClient extends EventEmitter {
  constructor({ apiKey, baseUrl, tierId }) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://bluffed.online';
    this.tierId = tierId ?? 't_low';
    this.seated = false;
    this.state = null;
    this.handTimeoutMs = 30_000;
    this.closed = false;
  }

  async connect() {}

  sit(buyIn) {
    queueMicrotask(() =>
      this.emit('state', {
        id: 't1',
        phase: 'handComplete',
        currentTurnSeat: null,
        players: [{ id: 'me', seat: 0, chips: buyIn, isYou: true }]
      })
    );
  }

  leave() {
    throw new Error('not connected — call connect() first');
  }

  action() {}

  async close() {
    this.closed = true;
  }
}

vi.mock('../src/client.js', () => ({ BluffedClient: MaybeDisconnectedClient, BluffedError: Error, TableError: Error }));

const { runForever } = await import('../src/runner.js');

class FakeAccount {
  async fund() {}
  async sweep() {}
}

describe('runForever cleanup', () => {
  it('does not throw when the client is not connected once the loop ends', async () => {
    // runForever's finally block used to call currentClient.leave()
    // unconditionally — on a real client this throws when there's no live
    // socket (e.g. the loop just ended right as a hand's connection had
    // already dropped), masking whatever the loop was actually returning.
    // close() alone already handles "leave if still seated" safely.
    const client = new MaybeDisconnectedClient({ apiKey: 'key', tierId: 't_low' });

    await expect(
      runForever(client, new FakeAccount(), 'agent_1', () => ({ type: 'fold' }), {
        buyIn: 1_000_000,
        autoTier: false,
        maxHands: 1,
        onEvent: () => {}
      })
    ).resolves.toBeUndefined();

    expect(client.closed).toBe(true);
  });
});
