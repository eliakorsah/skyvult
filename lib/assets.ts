/** Compact GHS formatter: ₵1,234 → ₵1.2K, ₵1,200,000 → ₵1.2M.
 *  Numbers below 1000 keep 2 decimal places as usual. */
export function fmtGhs(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}₵${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 1 : 2).replace(/\.?0+$/, "")}M`;
  if (abs >= 1_000)     return `${sign}₵${(abs / 1_000).toFixed(abs >= 10_000 ? 1 : 2).replace(/\.?0+$/, "")}K`;
  return `${sign}₵${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type AssetConfig = {
  symbol: string;
  price: number;
  volatility: number;
  decimals: number;
  /** Win multiplier, e.g. 1.80 = 80% profit. EUR/USD gets the best rate
   *  (most liquid); crypto and commodities are lower due to volatility. */
  payoutRatio: number;
};

export const ASSET_CONFIGS: Record<string, AssetConfig> = {
  "EUR/USD": { symbol: "EUR/USD", price: 1.085,  volatility: 0.00015, decimals: 5, payoutRatio: 1.80 },
  "GBP/USD": { symbol: "GBP/USD", price: 1.272,  volatility: 0.00018, decimals: 5, payoutRatio: 1.79 },
  "BTC/USD": { symbol: "BTC/USD", price: 67420,  volatility: 12.0,    decimals: 2, payoutRatio: 1.75 },
  "ETH/USD": { symbol: "ETH/USD", price: 3540,   volatility: 4.5,     decimals: 2, payoutRatio: 1.73 },
  "GOLD":    { symbol: "GOLD",    price: 2341,    volatility: 0.6,     decimals: 2, payoutRatio: 1.77 },
  "OIL":     { symbol: "OIL",     price: 78.4,    volatility: 0.04,    decimals: 3, payoutRatio: 1.72 },
};

export const ASSETS = Object.values(ASSET_CONFIGS);

export function isValidAsset(s: string) {
  return s in ASSET_CONFIGS;
}

// 1.80 → ~10% house edge with symmetric TP/SL (0.5 × 0.80 − 0.5 × 1 = −0.10).
// Win pays back amount × 1.80 (= 80% profit on stake). This is the max rate
// (EUR/USD). Other assets use lower rates defined in ASSET_CONFIGS.payoutRatio.
export const PAYOUT_RATIO = 1.80;

/** Returns the per-asset payout ratio, falling back to PAYOUT_RATIO (1.80). */
export function getPayoutRatio(asset: string): number {
  return ASSET_CONFIGS[asset]?.payoutRatio ?? PAYOUT_RATIO;
}

export const RISK = {
  MIN_TRADE: 10,
  MAX_TRADE: 5000,
  MAX_OPEN_PER_USER: 10,
  LARGE_TRADE_THRESHOLD: 1000,
  // Smallest real-money deposit accepted via MoMo. Lowered to ₵2 for testing.
  MIN_DEPOSIT: 2,
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
