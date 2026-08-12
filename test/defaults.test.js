import { describe, expect, it } from 'vitest';
import { BluffedClient } from '../src/client.js';
import { DEFAULT_BASE_URL } from '../src/defaults.js';
import { getTier } from '../src/tiers.js';

describe('BluffedClient defaults', () => {
  it('defaults base url and tier', () => {
    const client = new BluffedClient({ apiKey: 'bk_live_fake' });
    expect(client.baseUrl).toBe(DEFAULT_BASE_URL);
    expect(client.tierId).toBe('t_low');
  });

  it('accepts an explicit tier', () => {
    const client = new BluffedClient({ apiKey: 'bk_live_fake', tierId: 't_mid' });
    expect(client.tierId).toBe('t_mid');
    expect(getTier('t_mid').minBuyIn).toBe(20_000_000);
  });

  it('returns null for an unknown tier', () => {
    expect(getTier('t_nope')).toBeNull();
  });
});
