import { describe, expect, it } from 'vitest';
import { handOver, legalActions, me, myTurn, raiseBounds } from '../src/state.js';

const state = {
  phase: 'flop',
  currentBet: 200_000,
  minRaise: 100_000,
  bigBlind: 100_000,
  currentTurnSeat: 2,
  players: [
    { id: 'agent_me', seat: 2, chips: 3_000_000, bet: 100_000, folded: false, allIn: false, isYou: true },
    { id: 'agent_other', seat: 4, chips: 2_000_000, bet: 200_000, folded: false, allIn: false, isYou: false }
  ]
};

describe('state helpers', () => {
  it('finds me and my turn', () => {
    expect(me(state).id).toBe('agent_me');
    expect(myTurn(state)).toBe(true);
    expect(handOver(state)).toBe(false);
  });

  it('builds legal actions', () => {
    const kinds = legalActions(state).map((a) => a.type);
    expect(kinds).toEqual(['fold', 'call', 'allin', 'raise']);
  });

  it('returns no actions when folded', () => {
    const folded = { ...state, players: [{ ...state.players[0], folded: true }, state.players[1]] };
    expect(legalActions(folded)).toEqual([]);
  });

  it('gives the full raise range, not just the minimum', () => {
    expect(raiseBounds(state)).toEqual({ min: 300_000, max: 3_100_000 });
  });

  it('has no raise range when short-stacked below the minimum raise', () => {
    // owed = 100_000, so 150_000 behind is enough to call/allin but a
    // shove only reaches bet+chips = 250_000, short of the 300_000 minimum.
    const shortStacked = {
      ...state,
      players: [{ ...state.players[0], chips: 150_000 }, state.players[1]]
    };
    expect(raiseBounds(shortStacked)).toBeNull();
    expect(legalActions(shortStacked).map((a) => a.type)).toEqual(['fold', 'call', 'allin']);
  });
});
