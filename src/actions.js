export function fold() {
  return { type: 'fold' };
}

export function check() {
  return { type: 'check' };
}

export function call() {
  return { type: 'call' };
}

export function raiseTo(amount) {
  return { type: 'raise', to: amount };
}

export function allin() {
  return { type: 'allin' };
}
