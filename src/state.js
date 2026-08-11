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

export function legalActions(state) {
  const player = me(state);
  if (!player || player.folded || player.allIn) return [];

  const actions = [{ type: 'fold' }];
  const owed = state.currentBet - player.bet;
  actions.push(owed <= 0 ? { type: 'check' } : { type: 'call' });

  const stackBehind = player.chips;
  if (stackBehind > Math.max(owed, 0)) {
    actions.push({ type: 'allin' });
    const minTo = state.currentBet + Math.max(state.minRaise, state.bigBlind);
    if (player.bet + stackBehind >= minTo) {
      actions.push({ type: 'raise', to: minTo });
    }
  }

  return actions;
}
