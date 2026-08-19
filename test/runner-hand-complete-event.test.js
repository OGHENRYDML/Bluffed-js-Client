import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/agent-self.js', () => ({
  getAgentStatus: vi.fn(async () => ({ availableMicros: 5_000_000 }))
}));

const { runForever } = await import('../src/runner.js');

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.baseUrl = 'https://bluffed.online';
    this.apiKey = 'key';
    this.tierId = 't_low';
  }

  async connect() {}

  sit(buyIn) {
    queueMicrotask(() =>
      this.emit('state', {
        phase: 'waiting',
        currentTurnSeat: null,
        maxSeats: 6,
        players: [{ isYou: true, seat: 0, chips: buyIn }]
      })
    );
    queueMicrotask(() =>
      this.emit('state', {
        phase: 'handComplete',
        currentTurnSeat: null,
        players: [{ isYou: true, seat: 0, chips: buyIn + 42_000 }]
      })
    );
  }

  leave() {}
  action() {}
  close() {}
}

class FakeAccount {
  async fund() {}
  async sweep() {}
}

describe('runForever hand_complete event', () => {
  it('carries the real chip outcome instead of just a hand count', async () => {
    const events = [];
    const client = new FakeClient();

    await runForever(client, new FakeAccount(), 'agent_1', () => ({ type: 'fold' }), {
      buyIn: 1_000_000,
      maxHands: 1,
      onEvent: (kind, data) => events.push([kind, data])
    });

    const handComplete = events.find(([kind]) => kind === 'hand_complete');
    expect(handComplete[1]).toEqual({ hands: 1, chipsDelta: 42_000, won: true });
  });
});
