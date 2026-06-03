-- 5s base candles for chart history. Larger timeframes (15s, 30s, 1m, 5m)
-- are aggregated client-side from these.
--
-- Retention: 24h rolling. The WS server prunes rows older than 24h on
-- startup and every hour. As a belt-and-braces safeguard you can also
-- schedule a pg_cron job inside Supabase:
--   SELECT cron.schedule('chart_candles_prune', '0 * * * *',
--     $$DELETE FROM chart_candles WHERE time < (extract(epoch FROM now()) - 24*3600)::bigint$$);

CREATE TABLE IF NOT EXISTS chart_candles (
  asset      text   NOT NULL,
  time       bigint NOT NULL,        -- unix seconds (bucketed to 5s)
  open       double precision NOT NULL,
  high       double precision NOT NULL,
  low        double precision NOT NULL,
  close      double precision NOT NULL,
  PRIMARY KEY (asset, time)
);

CREATE INDEX IF NOT EXISTS chart_candles_asset_time_desc
  ON chart_candles (asset, time DESC);

-- Disable RLS — only the service role writes/reads these.
ALTER TABLE chart_candles DISABLE ROW LEVEL SECURITY;
