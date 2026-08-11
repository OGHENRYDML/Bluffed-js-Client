export function toMicros(amount) {
  return Math.round(amount * 1_000_000);
}

export function fmtUsdc(micros) {
  return `$${(micros / 1_000_000).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
