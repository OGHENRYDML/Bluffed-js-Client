import { call, check, fold } from './actions.js';
import { legalActions } from './state.js';

export function callOrFold(state) {
  const legal = legalActions(state).map((a) => a.type);
  if (legal.includes('call')) return call();
  if (legal.includes('check')) return check();
  return fold();
}

export function randomLegal(state) {
  const legal = legalActions(state);
  if (legal.length === 0) return fold();
  return legal[Math.floor(Math.random() * legal.length)];
}

export function alwaysFold() {
  return fold();
}

export const STRATEGIES = { call: callOrFold, random: randomLegal, fold: alwaysFold };
