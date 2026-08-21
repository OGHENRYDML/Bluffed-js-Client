import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { playOneHand } from '../src/runner.js';

// assignTable's atomic seat reservation never oversells a table, but
// several near-simultaneous connects can still land on *different* tables
// instead of converging on one (a burst racing each other, not a
// correctness bug). This client simulates exactly that: the first sit()
// lands on a table that's accepted fine (no error) but never gets a second
// player — seatPlayer worked, nobody else is coming.
class LonelyClient extends EventEmitter {
  constructor(neverFillsCount) {
    super();
    this.seated = false;
    this.state = null;
    this.tierId = 't_low';
    this.handTimeoutMs = 30_000;
    this._neverFillsCount = neverFillsCount;
    this.connectCalls = 0;
  }

  async connect() {
    this.connectCalls += 1;
  }

  sit() {
    const stillLonely = this.connectCalls <= this._neverFillsCount;
    queueMicrotask(() => {
      if (stillLonely) {
        this.emit('state', { id: 't1', phase: 'waiting', currentTurnSeat: null, maxSeats: 6, players: [] });
      } else {
        this.emit('state', {
          id: 't1',
          phase: 'handComplete',
          currentTurnSeat: null,
          players: [{ id: 'me', seat: 0, chips: 1000, isYou: true }]
        });
      }
    });
  }

  action() {}
  async close() {}
}

describe('playOneHand: retries a fresh connect after being alone too long', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('gives up on a table that never fills and lands on one that does', async () => {
    const client = new LonelyClient(1); // lonely on attempt 1, fills on attempt 2
    const events = [];

    const resultPromise = playOneHand(client, 1000, () => ({ type: 'fold' }), (kind, data) => events.push([kind, data]));
    // Let the first sit()'s queued 'waiting' state land, then fast-forward
    // past LONELY_WAIT_MS (12s) — real time never actually passes.
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(12_000);
    await vi.advanceTimersByTimeAsync(0); // let the retry's queued state land

    const { chipsDelta } = await resultPromise;

    expect(chipsDelta).toBe(0);
    expect(client.connectCalls).toBe(2);
    const kinds = events.map(([kind]) => kind);
    expect(kinds).toEqual([
      'connecting',
      'connected',
      'waiting_for_players',
      'retrying_seat',
      'connecting',
      'connected'
    ]);
    expect(events[3][1]).toEqual({ attempt: 1, error: 'still_waiting_alone' });
  });

  it('gives up entirely after exhausting every retry, still alone', async () => {
    const client = new LonelyClient(Infinity); // never fills, ever
    const resultPromise = playOneHand(client, 1000, () => ({ type: 'fold' }), () => {});
    const assertion = expect(resultPromise).rejects.toThrow('still alone');

    for (let i = 0; i < 4; i++) {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(12_000);
    }

    await assertion;
    expect(client.connectCalls).toBe(4); // MAX_SIT_ATTEMPTS
  });

  it('does not arm the lonely timer when resuming an already-seated client', async () => {
    // Different situation entirely: this client already holds a seat (it's
    // *resuming*, not doing a fresh connect+sit) and the rest of its table
    // happens to have emptied out. Abandoning a seat already held to go
    // find a fuller table is a bigger behavior change than retrying a
    // connect that never landed anywhere — out of scope for this fix.
    const client = new LonelyClient(0);
    client.seated = true;
    client.state = { id: 't1', phase: 'waiting', currentTurnSeat: null, maxSeats: 6, players: [] };

    const resultPromise = playOneHand(client, 1000, () => ({ type: 'fold' }), () => {});
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(12_000);

    expect(client.connectCalls).toBe(0); // never tried a fresh connect at all
    // Nothing ever resolves this hand from here — that's expected (the
    // client is genuinely alone and nothing about that changes on its own
    // in this test); handTimeoutMs would eventually reject it in real use.
    resultPromise.catch(() => {});
  });
});
