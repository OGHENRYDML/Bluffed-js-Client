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
    this.connectCalls = 0;
    this.sitCalls = 0;
  }

  async connect() {
    this.connectCalls += 1;
  }
  sit() {
    this.sitCalls += 1;
  }
  action() {}
  async close() {}
}

describe('playOneHand: resumes an already-seated client instead of reconnecting', () => {
  it('does not call connect()/sit() again when the client is already seated', async () => {
    const client = new FakeClient();
    // Simulate the state left behind by a prior playOneHand() call that
    // just resolved on this same client — still connected, still seated,
    // the previous hand just ended.
    client.seated = true;
    client.state = { id: 't1', phase: 'handComplete', handNumber: 1, currentTurnSeat: null, players: [{ id: 'me', seat: 0, chips: 1000, isYou: true }] };

    const promise = playOneHand(client, 1000, () => ({ type: 'call' }), () => {});

    expect(client.connectCalls).toBe(0);
    expect(client.sitCalls).toBe(0);

    // The next hand deals.
    client.emit('state', {
      id: 't1',
      phase: 'preflop',
      handNumber: 2,
      currentTurnSeat: 0,
      currentBet: 2,
      minRaise: 2,
      bigBlind: 2,
      players: [{ id: 'me', seat: 0, chips: 1000, bet: 0, hasActed: false, isYou: true }]
    });
    client.emit('state', { id: 't1', phase: 'handComplete', handNumber: 2, currentTurnSeat: null, players: [{ id: 'me', seat: 0, chips: 900, isYou: true }] });

    const { chipsDelta } = await promise;
    expect(chipsDelta).toBe(-100);
    expect(client.connectCalls).toBe(0);
    expect(client.sitCalls).toBe(0);
  });

  it('does not resolve immediately off a cached rebroadcast of the hand that just ended', async () => {
    // reset()'s Python equivalent bug: without hand-number filtering, this
    // would resolve on the SAME handComplete we already consumed instead
    // of waiting for the next hand to actually start.
    const client = new FakeClient();
    client.seated = true;
    client.state = { id: 't1', phase: 'handComplete', handNumber: 5, currentTurnSeat: null, players: [{ id: 'me', seat: 0, chips: 1000, isYou: true }] };

    const promise = playOneHand(client, 1000, () => ({ type: 'call' }), () => {});
    let settled = false;
    promise.then(() => {
      settled = true;
    });

    await new Promise((r) => queueMicrotask(r));
    await new Promise((r) => queueMicrotask(r));
    expect(settled).toBe(false); // still waiting on hand 5's stale rebroadcast, correctly

    client.emit('state', {
      id: 't1',
      phase: 'handComplete',
      handNumber: 6,
      currentTurnSeat: null,
      players: [{ id: 'me', seat: 0, chips: 1100, isYou: true }]
    });

    const { chipsDelta } = await promise;
    expect(chipsDelta).toBe(100);
  });

  it('resumes mid-hand (not just handComplete) when recovering from a truncated previous attempt', async () => {
    // Not every playOneHand() rejection means the hand ended — a timeout
    // or a send failure mid-hand leaves the client still seated, still
    // mid-hand. The next call must react to the CURRENT state (it may
    // already be our turn) rather than waiting for a brand new hand.
    const client = new FakeClient();
    client.seated = true;
    client.state = {
      id: 't1',
      phase: 'preflop',
      handNumber: 3,
      currentTurnSeat: 0,
      currentBet: 2,
      minRaise: 2,
      bigBlind: 2,
      players: [{ id: 'me', seat: 0, chips: 998, bet: 0, hasActed: false, isYou: true }]
    };

    const sent = [];
    const promise = playOneHand(
      client,
      1000,
      (state) => {
        sent.push(state.handNumber);
        return { type: 'call' };
      },
      () => {}
    );

    await new Promise((r) => queueMicrotask(r));
    expect(sent).toEqual([3]); // acted on the cached mid-hand state immediately, no fresh connect needed

    client.emit('state', { id: 't1', phase: 'handComplete', handNumber: 3, currentTurnSeat: null, players: [{ id: 'me', seat: 0, chips: 900, isYou: true }] });
    await promise;
    expect(client.connectCalls).toBe(0);
  });
});
