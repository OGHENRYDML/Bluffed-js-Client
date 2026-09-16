import { EventEmitter } from 'node:events';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

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

const { InMemoryTransport } = await import('@modelcontextprotocol/sdk/inMemory.js');
const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
const { server } = await import('../src/mcp-server.js');

function parseResult(res) {
  return JSON.parse(res.content[0].text);
}

// One server instance backs every tool registration (module-level `client`
// state included, same as Python's mcp_server.py), so every test in this
// file shares a single connected transport pair rather than each trying to
// connect the same server to a fresh one.
let client;

beforeAll(async () => {
  const [serverTransport, clientTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterAll(async () => {
  await server.close();
});

describe('MCP server tools', () => {
  it('rejects get_observation/take_action/legal_actions before sit_down with the real message, not a generic crash', async () => {
    for (const name of ['get_observation', 'legal_actions']) {
      const res = await client.callTool({ name, arguments: {} });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toBe('not seated — call sit_down first');
    }
    const res = await client.callTool({ name: 'take_action', arguments: { actionType: 'fold' } });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('not seated — call sit_down first');
  });

  it('rejects an unknown tier_id with its own message', async () => {
    const res = await client.callTool({
      name: 'sit_down',
      arguments: { apiKey: 'key', tierId: 'not_a_real_tier' }
    });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe('unknown tierId "not_a_real_tier"');
  });

  it('sits down, reads the observation and legal actions, and takes an action', async () => {
    const connectPromise = client.callTool({
      name: 'sit_down',
      arguments: { apiKey: 'key', tierId: 't_low' }
    });

    // Wait for connect()'s WebSocket to be constructed, then drive it like
    // a real table connection: open, then a state broadcast where it's
    // already our turn (skips straight to the "back to you" wait).
    await vi.waitFor(() => expect(lastSocket).toBeDefined());
    lastSocket.emit('open');
    await vi.waitFor(() => expect(lastSocket.sent.some((m) => m.type === 'sit')).toBe(true));
    lastSocket.emit(
      'message',
      JSON.stringify({
        type: 'state',
        state: {
          id: 't1',
          phase: 'preflop',
          currentTurnSeat: 0,
          currentBet: 200,
          minRaise: 200,
          bigBlind: 200,
          players: [{ id: 'me', seat: 0, chips: 4_000_000, bet: 0, isYou: true, hasActed: false }]
        }
      })
    );

    const sitResult = parseResult(await connectPromise);
    expect(sitResult.observation.phase).toBe('preflop');
    expect(sitResult.info.myId).toBe('me');

    const legalRes = parseResult(await client.callTool({ name: 'legal_actions', arguments: {} }));
    expect(legalRes.map((a) => a.type)).toContain('call');

    const actionPromise = client.callTool({ name: 'take_action', arguments: { actionType: 'call' } });
    await vi.waitFor(() => expect(lastSocket.sent.some((m) => m.type === 'action')).toBe(true));
    lastSocket.emit(
      'message',
      JSON.stringify({
        type: 'state',
        state: {
          id: 't1',
          phase: 'handComplete',
          currentTurnSeat: null,
          currentBet: 0,
          minRaise: 200,
          bigBlind: 200,
          players: [{ id: 'me', seat: 0, chips: 3_800_000, bet: 0, isYou: true, hasActed: true }]
        }
      })
    );
    const actionResult = parseResult(await actionPromise);
    expect(actionResult.observation.phase).toBe('handComplete');

    const leaveResult = parseResult(await client.callTool({ name: 'leave_table', arguments: {} }));
    expect(leaveResult).toEqual({ ok: true });

    // Now stood up — the same "not seated" message as before sitting down.
    const afterLeave = await client.callTool({ name: 'get_observation', arguments: {} });
    expect(afterLeave.isError).toBe(true);
    expect(afterLeave.content[0].text).toBe('not seated — call sit_down first');
  });
});
