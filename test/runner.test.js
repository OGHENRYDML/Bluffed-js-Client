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

  it('sweeps even with funding disabled (the --auto-tier case)', () => {
    // --auto-tier passes minReserve/topUpTo as undefined since the tier
    // itself tracks the balance instead — --sweep-above must still work,
    // it isn't bundled with funding.
    const { kind, micros } = decideBankrollAction(12_000_000, {
      sweepAbove: 10_000_000,
      sweepDownTo: 6_000_000
    });
    expect(kind).toBe('sweep');
    expect(micros).toBe(6_000_000);
  });

  it('never funds when minReserve/topUpTo are missing', () => {
    const { kind, micros } = decideBankrollAction(1_000_000, { sweepAbove: 10_000_000 });
    expect(kind).toBe(null);
    expect(micros).toBe(0);
  });
});
