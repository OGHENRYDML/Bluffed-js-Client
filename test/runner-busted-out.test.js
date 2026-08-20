import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { playOneHand } from '../src/runner.js';

class FakeClient extends EventEmitter {
  constructor() {
    super();
    this.seated = false;
    this.state = null;
    this.tierId = 't_low';
    this.handTimeoutMs = 30_000;
  }

  async connect() {}
  sit() {}
  action() {}
  async close() {}
}

describe('playOneHand: busted out (removed from the table mid-hand)', () => {
  it('rejects with removed_from_table instead of hanging forever waiting for an unrelated hand', async () => {
    const client = new FakeClient();
    const events = [];
    const promise = playOneHand(client, 1000, () => ({ type: 'call' }), (kind, data) => events.push([kind, data]));

    // We were seated (chips visible) ...
    client.emit('state', {
      phase: 'preflop',
      currentTurnSeat: 1,
      players: [
        { id: 'me', seat: 0, chips: 0, hasActed: false, isYou: true },
        { id: 'other', seat: 1, chips: 900, hasActed: false, isYou: false }
      ]
    });

    // ... then the server removes us entirely (busted, no rebuy) — no
    // longer in the player list at all, mid-hand, not via handComplete.
    client.emit('state', {
      id: 't1',
      phase: 'preflop',
      currentTurnSeat: 1,
      players: [{ id: 'other', seat: 1, chips: 900, hasActed: false, isYou: false }]
    });

    await expect(promise).rejects.toThrow('removed_from_table');
    expect(events.some(([kind]) => kind === 'busted_out')).toBe(true);
  });

  it('does not misfire on the very first state before we have ever seen ourselves seated', async () => {
    // A state that simply doesn't include us yet (e.g. a broadcast that
    // landed before our own seat confirmation did) must not be mistaken
    // for having been removed — we were never confirmed present to begin
    // with.
    const client = new FakeClient();
    const promise = playOneHand(client, 1000, () => ({ type: 'call' }), () => {});

    client.emit('state', {
      phase: 'waiting',
      currentTurnSeat: null,
      maxSeats: 6,
      players: [{ id: 'other', seat: 1, chips: 900, hasActed: false, isYou: false }]
    });

    client.emit('state', {
      phase: 'handComplete',
      currentTurnSeat: null,
      players: [{ id: 'me', seat: 0, chips: 1000, hasActed: false, isYou: true }]
    });

    await expect(promise).resolves.toBeTruthy();
  });
});
