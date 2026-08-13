export function me(state) {
  return state.players.find((p) => p.isYou) ?? null;
}

export function myTurn(state) {
  const player = me(state);
  return player !== null && state.currentTurnSeat === player.seat;
}

export function handOver(state) {
  return state.phase === 'handComplete';
}

/**
 * { min, max } — the range of legal target total bets for a raise this
 * turn, in USDC micros. Both ends are legal, and so is everything between
 * them. null if raising isn't legal right now (not enough chips behind to
 * meet the table minimum — shoving is still allowed via `allin`, just not
 * as a `raise`).
 */
export function raiseBounds(state) {
  const player = me(state);
  if (!player || player.folded || player.allIn) return null;
  const owed = state.currentBet - player.bet;
  const stackBehind = player.chips;
  if (stackBehind <= Math.max(owed, 0)) return null;
  const minTo = state.currentBet + Math.max(state.minRaise, state.bigBlind);
  const maxTo = player.bet + stackBehind;
  if (maxTo < minTo) return null;
  return { min: minTo, max: maxTo };
}

export function legalActions(state) {
  const player = me(state);
  if (!player || player.folded || player.allIn) return [];

  const actions = [{ type: 'fold' }];
  const owed = state.currentBet - player.bet;
  actions.push(owed <= 0 ? { type: 'check' } : { type: 'call' });

  const stackBehind = player.chips;
  if (stackBehind > Math.max(owed, 0)) {
    actions.push({ type: 'allin' });
    const bounds = raiseBounds(state);
    if (bounds) actions.push({ type: 'raise', to: bounds.min });
  }

  return actions;
}
