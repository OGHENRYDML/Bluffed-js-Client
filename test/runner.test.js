import { describe, expect, it } from 'vitest';
import { decideBankrollAction } from '../src/runner.js';

describe('decideBankrollAction', () => {
  it('funds when below reserve', () => {
    const { kind, micros } = decideBankrollAction(1_000_000, { minReserve: 2_000_000, topUpTo: 5_000_000 });
    expect(kind).toBe('fund');
    expect(micros).toBe(4_000_000);
  });

  it('sweeps when above ceiling', () => {
    const { kind, micros } = decideBankrollAction(12_000_000, {
      minReserve: 2_000_000,
      topUpTo: 5_000_000,
      sweepAbove: 10_000_000
    });
    expect(kind).toBe('sweep');
    expect(micros).toBe(2_000_000);
  });

  it('sweeps down to an explicit target', () => {
    const { kind, micros } = decideBankrollAction(12_000_000, {
      minReserve: 2_000_000,
      topUpTo: 5_000_000,
      sweepAbove: 10_000_000,
      sweepDownTo: 6_000_000
    });
    expect(kind).toBe('sweep');
    expect(micros).toBe(6_000_000);
  });

  it('does nothing in the middle', () => {
    const { kind, micros } = decideBankrollAction(6_000_000, {
      minReserve: 2_000_000,
      topUpTo: 5_000_000,
      sweepAbove: 10_000_000
    });
    expect(kind).toBe(null);
    expect(micros).toBe(0);
  });
});
