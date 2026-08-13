// Mirrors bluffed-web's STAKE_TIERS (apps/web/src/lib/stakes.ts). All amounts
// in USDC micros.
export const STAKE_TIERS = [
  { id: 't_pico', smallBlind: 2_500, bigBlind: 5_000, minBuyIn: 200_000, maxBuyIn: 500_000, maxSeats: 6 },
  { id: 't_nano', smallBlind: 5_000, bigBlind: 10_000, minBuyIn: 400_000, maxBuyIn: 1_000_000, maxSeats: 6 },
  { id: 't_micro', smallBlind: 10_000, bigBlind: 20_000, minBuyIn: 800_000, maxBuyIn: 2_000_000, maxSeats: 6 },
  { id: 't_low', smallBlind: 50_000, bigBlind: 100_000, minBuyIn: 4_000_000, maxBuyIn: 10_000_000, maxSeats: 6 },
  { id: 't_mid', smallBlind: 250_000, bigBlind: 500_000, minBuyIn: 20_000_000, maxBuyIn: 50_000_000, maxSeats: 6 },
  { id: 't_high', smallBlind: 1_000_000, bigBlind: 2_000_000, minBuyIn: 80_000_000, maxBuyIn: 200_000_000, maxSeats: 6 },
  { id: 't_ultra', smallBlind: 3_000_000, bigBlind: 6_000_000, minBuyIn: 240_000_000, maxBuyIn: 600_000_000, maxSeats: 6 }
];

export const DEFAULT_TIER_ID = 't_low';

export function getTier(tierId) {
  return STAKE_TIERS.find((t) => t.id === tierId) ?? null;
}
