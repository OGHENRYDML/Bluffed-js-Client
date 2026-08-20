import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/agent-self.js', () => ({
  getAgentStatus: vi.fn(async () => ({ availableMicros: 5_000_000 }))
}));

const { runForeverMulti } = await import('../src/runner.js');

class FakeClient extends EventEmitter {
  constructor(baseUrl, apiKey) {
    super();
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
    this.connectCalls = 0;
    this.closed = false;
  }

  async connect() {
    this.connectCalls += 1;
  }

  sit() {
    // Hand is "over" the instant we sit, for a fast test.
    queueMicrotask(() => this.emit('state', { phase: 'handComplete', players: [{ isYou: true, chips: 0 }] }));
  }

  leave() {}

  action() {}

  close() {
    this.closed = true;
  }
}

class FakeAccount {
  constructor() {
    this.funded = [];
  }

  async fund(agentId, micros) {
    this.funded.push([agentId, micros]);
  }

  async sweep() {}
}

describe('runForeverMulti', () => {
  it('runs each table independently and tags events with agentId', async () => {
    const events = [];
    const configs = [
      {
        client: new FakeClient('https://bluffed.online', 'key_a'),
        account: new FakeAccount(),
        agentId: 'agent_a',
        strategy: () => ({ type: 'fold' }),
        // This test is about per-table threading/tagging, not tier logic —
        // FakeClient here has no tierId (unlike the real client), and
        // autoTier/hopAfterLosses default on now, so leave both off
        // explicitly rather than growing this fake to match.
        options: { buyIn: 4_000_000, minReserve: 1, topUpTo: 2, maxHands: 1, autoTier: false, hopAfterLosses: null }
      },
      {
        client: new FakeClient('https://bluffed.online', 'key_b'),
        account: new FakeAccount(),
        agentId: 'agent_b',
        strategy: () => ({ type: 'fold' }),
        options: { buyIn: 4_000_000, minReserve: 1, topUpTo: 2, maxHands: 1, autoTier: false, hopAfterLosses: null }
      }
    ];

    await runForeverMulti(configs, (kind, data) => events.push([kind, data]));

    expect(configs[0].client.connectCalls).toBe(1);
    expect(configs[1].client.connectCalls).toBe(1);
    expect(configs[0].client.closed).toBe(true);
    expect(configs[1].client.closed).toBe(true);

    const taggedAgentIds = new Set(events.map(([, data]) => data.agentId));
    expect(taggedAgentIds).toEqual(new Set(['agent_a', 'agent_b']));
  });
});
