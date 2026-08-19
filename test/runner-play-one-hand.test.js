import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { playOneHand } from '../src/runner.js';

class FakeClient extends EventEmitter {
  async connect() {}

  sit(buyIn) {
    // Nobody else at the table yet — this is the state a lone funded agent
    // sits in indefinitely until a second player joins. Not a bug, but
    // indistinguishable from a stuck connection without an event for it.
    queueMicrotask(() =>
      this.emit('state', {
        phase: 'waiting',
        currentTurnSeat: null,
        maxSeats: 6,
        players: [{ isYou: true, seat: 0, chips: buyIn }]
      })
    );
    // An opponent sits and the hand resolves.
    queueMicrotask(() =>
      this.emit('state', {
        phase: 'handComplete',
        currentTurnSeat: null,
        players: [{ isYou: true, seat: 0, chips: buyIn + 100 }]
      })
    );
  }

  action() {}
  close() {}
}

describe('playOneHand', () => {
  it('reports connecting/connected/waiting_for_players before resolving, without leaking the full table state', async () => {
    const client = new FakeClient();
    const events = [];
    const { chipsDelta } = await playOneHand(client, 1000, () => ({ type: 'fold' }), (kind, data) =>
      events.push([kind, data])
    );

    expect(events.map(([kind]) => kind)).toEqual(['connecting', 'connected', 'waiting_for_players']);
    expect(events[2][1]).toEqual({ seats: 1, maxSeats: 6 });
    expect(chipsDelta).toBe(100);
  });

  it('works with no onEvent callback at all', async () => {
    const client = new FakeClient();
    const { chipsDelta } = await playOneHand(client, 1000, () => ({ type: 'fold' }));
    expect(chipsDelta).toBe(100);
  });

  it('prints status by default when no onEvent is wired up — the actual ask', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const client = new FakeClient();
      await playOneHand(client, 1000, () => ({ type: 'fold' }));

      const lines = logSpy.mock.calls.map((args) => args.join(' '));
      expect(lines).toContainEqual(expect.stringContaining('Connecting'));
      expect(lines).toContainEqual(expect.stringContaining('Connected'));
      expect(lines).toContainEqual(expect.stringContaining('Waiting for other players'));
    } finally {
      logSpy.mockRestore();
    }
  });
});
