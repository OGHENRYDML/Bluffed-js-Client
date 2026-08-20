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
    this.sent = [];
  }

  async connect() {}
  sit() {}
  action(action) {
    this.sent.push(action);
  }
  async close() {}
}

function state(overrides) {
  return {
    id: 't1',
    phase: 'preflop',
    handNumber: 1,
    maxSeats: 6,
    currentTurnSeat: 0,
    currentBet: 100,
    minRaise: 100,
    bigBlind: 2,
    players: [{ id: 'me', name: 'me', seat: 0, chips: 900, bet: 0, folded: false, allIn: false, hasActed: false, isYou: true }],
    ...overrides
  };
}

describe('playOneHand: stale rebroadcast does not cause a duplicate resend', () => {
  it('skips a rebroadcast that still shows my_turn with hasActed still false', async () => {
    // The exact live bug: another player sitting down elsewhere broadcasts
    // to everyone, including a client mid-turn waiting on its own
    // already-sent action. That rebroadcast still shows myTurn=true with
    // hasActed still false, because the action hasn't landed yet — it must
    // not be mistaken for a fresh decision point.
    const client = new FakeClient();
    const promise = playOneHand(client, 1000, () => ({ type: 'call' }), () => {});

    client.emit('state', state({ currentTurnSeat: 0, players: [{ ...state().players[0], hasActed: false }] }));
    expect(client.sent.length).toBe(1);

    // Stale rebroadcast: unrelated mutation, our action still not processed.
    client.emit('state', state({ currentTurnSeat: 0, players: [{ ...state().players[0], hasActed: false }] }));
    expect(client.sent.length).toBe(1); // not resent

    // Real confirmation: turn moved to seat 1.
    client.emit(
      'state',
      state({
        currentTurnSeat: 1,
        players: [
          { ...state().players[0], bet: 100, chips: 800, hasActed: true },
          { id: 'other', name: 'other', seat: 1, chips: 900, bet: 0, folded: false, allIn: false, hasActed: false, isYou: false }
        ]
      })
    );
    expect(client.sent.length).toBe(1); // still just the one send

    client.emit('state', { ...state(), phase: 'handComplete', currentTurnSeat: null });
    await promise;
    expect(client.sent.length).toBe(1);
  });

  it('acts again immediately when hasActed flips true and it is already my turn again', async () => {
    // Rare heads-up edge case: every other player is folded/all-in and
    // it's immediately this seat's turn again — hasActed already true is
    // just as valid a "my action landed" signal as the turn moving away.
    const client = new FakeClient();
    const promise = playOneHand(client, 1000, () => ({ type: 'call' }), () => {});

    client.emit('state', state({ currentTurnSeat: 0, players: [{ ...state().players[0], hasActed: false }] }));
    expect(client.sent.length).toBe(1);

    client.emit('state', state({ currentTurnSeat: 0, players: [{ ...state().players[0], hasActed: true }] }));
    expect(client.sent.length).toBe(2); // a genuine new decision, not a stale rebroadcast

    client.emit('state', { ...state(), phase: 'handComplete', currentTurnSeat: null });
    await promise;
  });

  it('does not send anything before it is actually this seat\'s turn', async () => {
    const client = new FakeClient();
    const promise = playOneHand(client, 1000, () => ({ type: 'call' }), () => {});

    client.emit(
      'state',
      state({
        currentTurnSeat: 1,
        players: [
          { ...state().players[0], hasActed: false },
          { id: 'other', name: 'other', seat: 1, chips: 900, bet: 0, folded: false, allIn: false, hasActed: false, isYou: false }
        ]
      })
    );
    expect(client.sent.length).toBe(0);

    client.emit('state', { ...state(), phase: 'handComplete', currentTurnSeat: null });
    await promise;
    expect(client.sent.length).toBe(0);
  });
});
