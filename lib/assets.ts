/** Compact GHS formatter: ₵1,234 → ₵1.2K, ₵1,200,000 → ₵1.2M.
 *  Numbers below 1000 keep 2 decimal places as usual. */
export function fmtGhs(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}₵${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000)     return `${sign}₵${(abs / 1_000).toFixed(abs >= 10_000 ? 1 : 2).replace(/\.?0+$/, "")}K`;
  return `${sign}₵${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Full GHS amount, never abbreviated: ₵1,234,567.89. Use where the exact
 *  balance matters (e.g. the nav balance); pair with responsive text sizing
 *  so long values don't overflow on small screens. */
export function fmtGhsFull(n: number): string {
  return `₵${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type AssetConfig = {
  symbol: string;
  price: number;
  volatility: number;
  decimals: number;
  /** Win multiplier, e.g. 1.80 = 80% profit. SVX Prime gets the best rate
   *  (most liquid); crypto and commodities are lower due to volatility. */
  payoutRatio: number;
};

export const ASSET_CONFIGS: Record<string, AssetConfig> = {
  "SVX Prime":    { symbol: "SVX Prime",    price: 1.085,  volatility: 0.00015, decimals: 5, payoutRatio: 1.80 },
  "SVX Alpha":    { symbol: "SVX Alpha",    price: 1.272,  volatility: 0.00018, decimals: 5, payoutRatio: 1.79 },
  "SVX Titan":    { symbol: "SVX Titan",    price: 67420,  volatility: 12.0,    decimals: 2, payoutRatio: 1.75 },
  "SVX Quantum":  { symbol: "SVX Quantum",  price: 3540,   volatility: 4.5,     decimals: 2, payoutRatio: 1.73 },
  "SVX Velocity": { symbol: "SVX Velocity", price: 2341,   volatility: 0.6,     decimals: 2, payoutRatio: 1.77 },
  "SVX Nova":     { symbol: "SVX Nova",     price: 78.4,   volatility: 0.04,    decimals: 3, payoutRatio: 1.72 },
};

export const ASSETS = Object.values(ASSET_CONFIGS);

export function isValidAsset(s: string) {
  return s in ASSET_CONFIGS;
}

// 1.80 → ~10% house edge with symmetric TP/SL (0.5 × 0.80 − 0.5 × 1 = −0.10).
// Win pays back amount × 1.80 (= 80% profit on stake). This is the max rate
// (SVX Prime). Other assets use lower rates defined in ASSET_CONFIGS.payoutRatio.
export const PAYOUT_RATIO = 1.80;

/** Returns the per-asset payout ratio, falling back to PAYOUT_RATIO (1.80). */
export function getPayoutRatio(asset: string): number {
  return ASSET_CONFIGS[asset]?.payoutRatio ?? PAYOUT_RATIO;
}

// Deposits run through Paystack (Ghana Mobile Money). The deposit route
// also checks isPaystackConfigured(), so this stays true even before
// PAYSTACK_SECRET_KEY is set — the route returns 503 in that case.
export const DEPOSITS_ENABLED = true;

export const RISK = {
  MIN_TRADE: 10,
  MAX_TRADE: 5000,
  MAX_OPEN_PER_USER: 10,
  LARGE_TRADE_THRESHOLD: 1000,
  // TEMP for live MoMo testing — raise back to 80 before launch. ₵10 is the
  // real floor enforced by MTN/Korapay (smaller amounts are rejected with
  // "Transaction limit not met"). Normally higher than MIN_TRADE so the
  // per-transaction MoMo fee (~₵0.50–₵1) stays under ~1.5% of the deposit,
  // and high enough that the ₵30 referral bonus can't be farmed profitably.
  MIN_DEPOSIT: 80,
};

export const EXPIRY_OPTIONS = [5, 30, 60, 120, 180, 300];

/** Volatility-scaled, symmetric distance from entry price to TP/SL. Same
 *  formula used on both the chart preview (client) and the trade API
 *  (server) so the price lines you see match the levels the server will
 *  watch. Tuned roughly to ~2σ of expected movement over `expirySeconds`. */
export function tpSlDistance(asset: string, expirySeconds: number): number {
  const cfg = ASSET_CONFIGS[asset];
  if (!cfg) return 0;
  // cfg.volatility is per-tick std-dev-ish. Engine ticks 20/s, so
  // accumulated movement over expiry ≈ volatility × √(expiry × 20).
  // The constant 8 ≈ 2 × √20 ≈ rolls the tick rate in and pushes to ~2σ.
  return cfg.volatility * Math.sqrt(expirySeconds) * 8;
}
