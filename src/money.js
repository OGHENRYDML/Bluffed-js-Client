/**
 * Dollars to USDC micros (1 USDC = 1,000,000 micros) — the unit every wire
 * amount (buyIn, raiseTo, fund, sweep) actually uses. Write code in
 * dollars, let this do the conversion once instead of scattering
 * _000_000 through it.
 */
export function usdc(amount) {
  return Math.round(amount * 1_000_000);
}

export function fmtUsdc(micros) {
  return `$${(micros / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
