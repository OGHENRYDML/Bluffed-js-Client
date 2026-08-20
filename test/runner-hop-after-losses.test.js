import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/agent-self.js', () => ({
  getAgentStatus: vi.fn(async () => ({ availableMicros: 1_000_000_000 })) // $1000 — irrelevant here, autoTier is off in every test
}));

// Shared, test-mutable queue: runForever() constructs a brand new client on
// every hop, the same way the real BluffedClient would, so the fake reads
// its scripted chip delta from a queue outside any one instance.
const rewardQueue = { current: [] };

class LossyClient extends EventEmitter {
  constructor({ apiKey, baseUrl, tierId }) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl ?? 'https://bluffed.online';
    this.tierId = tierId ?? 't_low';
    this.seated = false;
    this.state = null;
    this.handTimeoutMs = 30_000;
  }

  async connect() {}

  sit(buyIn) {
    // Two states, not one: startingChips and endingChips both come from
    // whatever onState() sees first and last, so a single state (already
    // handComplete) would make them the same snapshot and chipsDelta
    // always 0, never actually exercising the loss-streak counter.
    queueMicrotask(() =>
      this.emit('state', {
        id: 't1',
        phase: 'preflop',
        currentTurnSeat: null,
        players: [{ id: 'me', seat: 0, chips: buyIn, isYou: true }]
      })
    );
    queueMicrotask(() => {
      const delta = rewardQueue.current.length > 0 ? rewardQueue.current.shift() : 0;
      this.emit('state', {
        id: 't1',
        phase: 'handComplete',
        currentTurnSeat: null,
        players: [{ id: 'me', seat: 0, chips: buyIn + delta, isYou: true }]
      });
    });
  }

  leave() {}
  action() {}
  async close() {}
}

vi.mock('../src/client.js', () => ({ BluffedClient: LossyClient, BluffedError: Error, TableError: Error }));

const { runForever } = await import('../src/runner.js');

class FakeAccount {
  async fund() {}
  async sweep() {}
}

describe('runForever hopAfterLosses', () => {
  it('leaves the table for a fresh one after the losing streak', async () => {
    rewardQueue.current = [-1, -1, -1];
    const client = new LossyClient({ apiKey: 'key', tierId: 't_low' });
    const events = [];

    await runForever(client, new FakeAccount(), 'agent_1', () => ({ type: 'fold' }), {
      buyIn: 1_000_000,
      autoTier: false,
      hopAfterLosses: 3,
      maxHands: 4, // one extra iteration so the post-streak check actually runs
      onEvent: (kind, data) => events.push([kind, data])
    });

    const hops = events.filter(([kind]) => kind === 'table_hopped').map(([, data]) => data);
    expect(hops).toEqual([{ tier: 't_low', afterLosses: 3 }]);
  });

  it('resets the streak on a win', async () => {
    // Same shape as the test above (5 hands, threshold 3) but the third
    // hand wins, so the streak that would otherwise trigger a hop never
    // rebuilds.
    rewardQueue.current = [-1, -1, 1, -1, -1];
    const client = new LossyClient({ apiKey: 'key', tierId: 't_low' });
    const events = [];

    await runForever(client, new FakeAccount(), 'agent_1', () => ({ type: 'fold' }), {
      buyIn: 1_000_000,
      autoTier: false,
      hopAfterLosses: 3,
      maxHands: 5,
      onEvent: (kind, data) => events.push([kind, data])
    });

    expect(events.filter(([kind]) => kind === 'table_hopped')).toEqual([]);
  });

  it('is skipped on a hand autoTier already reconnected on', async () => {
    // $25 (t_mid) for two hands, then drops to $0.30 (t_pico) right as the
    // loss streak also crosses the hop threshold — only the tier change
    // should fire, not also a same-iteration table hop.
    const { getAgentStatus } = await import('../src/agent-self.js');
    getAgentStatus
      .mockResolvedValueOnce({ availableMicros: 25_000_000 })
      .mockResolvedValueOnce({ availableMicros: 25_000_000 })
      .mockResolvedValueOnce({ availableMicros: 300_000 });
    rewardQueue.current = [-1, -1, -1];
    const client = new LossyClient({ apiKey: 'key', tierId: 't_mid' });
    const events = [];

    await runForever(client, new FakeAccount(), 'agent_1', () => ({ type: 'fold' }), {
      buyIn: 1_000_000,
      autoTier: true,
      hopAfterLosses: 2,
      maxHands: 3,
      onEvent: (kind, data) => events.push([kind, data])
    });

    const kinds = events.filter(([kind]) => kind === 'tier_changed' || kind === 'table_hopped').map(([kind]) => kind);
    expect(kinds).toEqual(['tier_changed']);
  });
});
