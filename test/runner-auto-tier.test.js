import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/agent-self.js', () => ({
  getAgentStatus: vi.fn()
}));

class FakeClient extends EventEmitter {
  constructor({ apiKey, baseUrl = 'https://bluffed.online', tierId = 't_low' }) {
    super();
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.tierId = tierId;
    this.closed = false;
  }

  async connect() {}

  sit() {
    queueMicrotask(() => this.emit('state', { phase: 'handComplete', players: [{ isYou: true, chips: 0 }] }));
  }

  leave() {}

  action() {}

  close() {
    this.closed = true;
  }
}

vi.mock('../src/client.js', () => ({ BluffedClient: FakeClient }));

const { runForever, pickTierForBalance } = await import('../src/runner.js');
const { getAgentStatus } = await import('../src/agent-self.js');

class FakeAccount {
  async fund() {}
  async sweep() {}
}

describe('pickTierForBalance', () => {
  it('picks the richest tier the balance can afford', () => {
    expect(pickTierForBalance(5_000_000).id).toBe('t_low'); // $5
  });

  it('falls back to the smallest tier when broke', () => {
    expect(pickTierForBalance(1).id).toBe('t_pico');
  });

  it('picks the top tier when rich', () => {
    expect(pickTierForBalance(1_000_000_000).id).toBe('t_ultra'); // $1,000
  });
});

describe('runForever with autoTier', () => {
  it('is off by default and never switches tiers', async () => {
    getAgentStatus.mockResolvedValue({ availableMicros: 1_000_000_000 });
    const events = [];
    const client = new FakeClient({ apiKey: 'key', tierId: 't_low' });

    await runForever(client, new FakeAccount(), 'agent_1', () => ({ type: 'fold' }), {
      buyIn: 1,
      maxHands: 1,
      onEvent: (kind, data) => events.push([kind, data])
    });

    expect(events.map(([kind]) => kind)).toEqual(['hand_complete']);
  });

  it('moves up when the balance affords a richer tier', async () => {
    getAgentStatus.mockResolvedValue({ availableMicros: 25_000_000 }); // $25, constant
    const events = [];
    const client = new FakeClient({ apiKey: 'key', tierId: 't_low' });

    await runForever(client, new FakeAccount(), 'agent_1', () => ({ type: 'fold' }), {
      buyIn: 1,
      autoTier: true,
      maxHands: 2,
      onEvent: (kind, data) => events.push([kind, data])
    });

    const tierChanges = events.filter(([kind]) => kind === 'tier_changed').map(([, data]) => data);
    expect(tierChanges).toEqual([{ from: 't_low', to: 't_mid' }]);
  });

  it('moves down when the balance shrinks', async () => {
    getAgentStatus.mockResolvedValueOnce({ availableMicros: 25_000_000 }).mockResolvedValueOnce({ availableMicros: 300_000 });
    const events = [];
    const client = new FakeClient({ apiKey: 'key', tierId: 't_mid' });

    await runForever(client, new FakeAccount(), 'agent_1', () => ({ type: 'fold' }), {
      buyIn: 1,
      autoTier: true,
      maxHands: 2,
      onEvent: (kind, data) => events.push([kind, data])
    });

    const tierChanges = events.filter(([kind]) => kind === 'tier_changed').map(([, data]) => data);
    expect(tierChanges).toEqual([{ from: 't_mid', to: 't_pico' }]);
  });
});
