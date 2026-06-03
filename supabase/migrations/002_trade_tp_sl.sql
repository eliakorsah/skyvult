-- Price-based outcome: trades may close early when the live price touches
-- either the take-profit or stop-loss level. Both are computed from the
-- entry price using a volatility-scaled, expiry-aware envelope and stored
-- per-trade so the settlement worker can do the comparison without
-- re-deriving distance from asset config later.
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS tp_price double precision,
  ADD COLUMN IF NOT EXISTS sl_price double precision;

-- Backfill: any pre-existing OPEN trade has neither column, so the
-- settlement worker will fall back to the direction-at-expiry path.
-- No data migration required for historical resolved trades.
