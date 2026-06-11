import { redis, KEYS } from "../lib/redis";
import { ASSETS, AssetConfig } from "../lib/assets";
import { supabaseAdmin } from "../lib/supabase";

// ── Tuning ──────────────────────────────────────────────────────────────────
const TICK_INTERVAL_MS = 50;         // 20 ticks/sec — Pocket Option-grade smoothness
const VOLATILITY_DAMP  = 1.20;       // per-tick step — large enough that in-progress candle visibly grows on a mobile screen (Pocket Option-style)
const REVERSION_RATE   = 0.0008;     // pull-back strength toward base price per tick
const CLAMP_PCT        = 0.15;       // hard cap: price stays within ±15% of base
const BASE_CANDLE_SEC  = 5;          // 5-second base candle resolution
const HISTORY_HOURS    = 24;         // rolling retention — older rows are deleted
const HISTORY_SEC      = HISTORY_HOURS * 3600;
const HISTORY_TICK_BUFFER = 600;     // recent ticks kept in memory for snapshot
const PERSIST_BATCH_MS = 3000;       // flush completed candles to DB every 3s
const PERSIST_CHUNK    = 500;        // Supabase upserts above ~1k start failing
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000; // prune old candles hourly

// ── Types ───────────────────────────────────────────────────────────────────
export type Tick = {
  asset: string;
  price: number;
  change: number;
  changePercent: number;
  timestamp: number;
  candle: { open: number; high: number; low: number; close: number; time: number };
};

export type Candle = {
  asset: string;
  time:  number;            // unix seconds, bucketed to BASE_CANDLE_SEC
  open:  number;
  high:  number;
  low:   number;
  close: number;
};

type State = {
  price: number;
  trend: number;
  trendMag: number;
  ticksUntilFlip: number;
  // current in-progress base candle
  bucket: number;           // start time (s)
  open:   number;
  high:   number;
  low:    number;
};

// ── Engine state ────────────────────────────────────────────────────────────
const state    = new Map<string, State>();
const tickHistory = new Map<string, Tick[]>();   // recent ticks (live tail)
const candles  = new Map<string, Candle[]>();    // 5s candles for last 36h (in-memory)
const pendingPersist: Candle[] = [];             // buffer flushed to DB periodically

// ── Helpers ─────────────────────────────────────────────────────────────────
function round(n: number, d: number) {
  const m = 10 ** d;
  return Math.round(n * m) / m;
}

function trendMag(cfg: AssetConfig) {
  // Momentum drift per tick. Kept small (was 0.05) so the price stays lively
  // but the directional bias is far below the noise floor — a trend-following
  // user can't accumulate enough edge over a short expiry to beat the
  // symmetric-TP/SL house edge (payout 1.80 ⇒ break-even win rate 55.6%).
  return cfg.volatility * 0.012;
}

function bucketOf(timestampMs: number): number {
  return Math.floor(timestampMs / 1000 / BASE_CANDLE_SEC) * BASE_CANDLE_SEC;
}

function initState(cfg: AssetConfig, now: number): State {
  return {
    price: cfg.price,
    trend: Math.random() > 0.5 ? 1 : -1,
    trendMag: trendMag(cfg),
    ticksUntilFlip: 50 + Math.floor(Math.random() * 100),
    bucket: bucketOf(now),
    open: cfg.price,
    high: cfg.price,
    low:  cfg.price,
  };
}

function pushCandle(asset: string, c: Candle) {
  const arr = candles.get(asset) ?? [];
  // If a candle for this bucket already exists (server restart edge case),
  // replace it instead of appending — appending would break the ascending
  // ordering invariant that lightweight-charts requires.
  const last = arr[arr.length - 1];
  if (last && last.time === c.time) {
    arr[arr.length - 1] = c;
  } else if (last && c.time < last.time) {
    // Out-of-order push — find correct slot or drop. Should be rare.
    const idx = arr.findIndex((x) => x.time === c.time);
    if (idx >= 0) arr[idx] = c;
    // else: drop silently — older than newest, no slot
  } else {
    arr.push(c);
  }
  // Trim to retention window
  const cutoff = Math.floor(Date.now() / 1000) - HISTORY_SEC;
  while (arr.length > 0 && arr[0].time < cutoff) arr.shift();
  candles.set(asset, arr);
  pendingPersist.push(c);
}

function nextTick(cfg: AssetConfig, s: State, now: number): Tick {
  // Random walk + trend drift + mean reversion. The reversion term gently
  // pulls the price back toward cfg.price, so it stays in a realistic band
  // over hours/days instead of drifting to the clamp edge.
  const randomMove = (Math.random() - 0.5) * cfg.volatility * 2 * VOLATILITY_DAMP;
  const drift      = s.trend * s.trendMag * VOLATILITY_DAMP;
  const reversion  = (cfg.price - s.price) * REVERSION_RATE;
  let newPrice = s.price + randomMove + drift + reversion;
  // Hard cap so even a long unfavorable run can't push price outside ±15%
  const lo = cfg.price * (1 - CLAMP_PCT);
  const hi = cfg.price * (1 + CLAMP_PCT);
  newPrice = Math.max(lo, Math.min(hi, newPrice));
  newPrice = round(newPrice, cfg.decimals);

  const prev = s.price;
  const change = round(newPrice - prev, cfg.decimals);
  const changePercent = prev !== 0 ? round((change / prev) * 100, 4) : 0;

  // Update / roll the base candle
  const nowSec = Math.floor(now / 1000);
  const bucket = Math.floor(nowSec / BASE_CANDLE_SEC) * BASE_CANDLE_SEC;
  if (bucket !== s.bucket) {
    // Close previous candle
    pushCandle(cfg.symbol, {
      asset: cfg.symbol,
      time:  s.bucket,
      open:  s.open,
      high:  s.high,
      low:   s.low,
      close: prev,
    });
    // Open new one
    s.bucket = bucket;
    s.open   = newPrice;
    s.high   = newPrice;
    s.low    = newPrice;
  } else {
    if (newPrice > s.high) s.high = newPrice;
    if (newPrice < s.low)  s.low  = newPrice;
  }

  // Flip trend every 50–150 ticks
  s.ticksUntilFlip -= 1;
  if (s.ticksUntilFlip <= 0) {
    s.trend = -s.trend;
    s.trendMag = trendMag(cfg) * (0.5 + Math.random());
    s.ticksUntilFlip = 50 + Math.floor(Math.random() * 100);
  }

  s.price = newPrice;

  return {
    asset: cfg.symbol,
    price: newPrice,
    change,
    changePercent,
    timestamp: now,
    candle: { open: s.open, high: s.high, low: s.low, close: newPrice, time: bucket },
  };
}

// ── Public API ──────────────────────────────────────────────────────────────
export function getLastPrice(asset: string): number | null {
  return state.get(asset)?.price ?? null;
}

/** Recent tick tail (used by clients to paint the in-progress candle smoothly). */
export async function getSnapshot(asset: string): Promise<Tick[]> {
  return tickHistory.get(asset) ?? [];
}

/** 5s candles for the last 36h, sorted ascending. Used for chart history. */
export function getCandles(asset: string): Candle[] {
  return candles.get(asset) ?? [];
}

// ── Persistence ─────────────────────────────────────────────────────────────
async function flushPendingPersist() {
  if (pendingPersist.length === 0) return;
  // Drain into a local batch first, then DEDUPE by (asset, time) — Postgres
  // upsert errors with "ON CONFLICT cannot affect row a second time" if a
  // single statement tries to update the same primary key twice. Keeping
  // the latest version of each candle is correct: subsequent writes
  // represent later ticks within the same bucket.
  const drained = pendingPersist.splice(0, pendingPersist.length);
  const dedupe = new Map<string, Candle>();
  for (const c of drained) dedupe.set(`${c.asset}:${c.time}`, c);
  const batch = [...dedupe.values()];

  for (let i = 0; i < batch.length; i += PERSIST_CHUNK) {
    const chunk = batch.slice(i, i + PERSIST_CHUNK);
    try {
      const { error } = await supabaseAdmin
        .from("chart_candles")
        .upsert(chunk, { onConflict: "asset,time", ignoreDuplicates: false });
      if (error) {
        console.error(`[priceEngine] persist chunk failed (${chunk.length} rows):`, error.message);
        if (pendingPersist.length + chunk.length < 10_000) {
          pendingPersist.unshift(...chunk);
        }
        break;
      }
    } catch (err: any) {
      console.error("[priceEngine] persist threw:", err?.message);
      if (pendingPersist.length + chunk.length < 10_000) {
        pendingPersist.unshift(...chunk);
      }
      break;
    }
  }
}

/** Delete historical candles whose prices are outside the realistic band for
 *  their asset. Prevents drifted data from a previous (broken) run from
 *  poisoning the chart's auto-scale. */
async function sanitizeBadHistory() {
  for (const cfg of ASSETS) {
    const lo = cfg.price * (1 - CLAMP_PCT * 1.5); // 1.5× CLAMP as a soft margin
    const hi = cfg.price * (1 + CLAMP_PCT * 1.5);
    try {
      const { data, error } = await supabaseAdmin
        .from("chart_candles")
        .delete()
        .eq("asset", cfg.symbol)
        .or(`low.lt.${lo},high.gt.${hi}`)
        .select("time");
      if (error) {
        console.error(`[priceEngine] sanitize ${cfg.symbol} failed:`, error.message);
      } else if ((data?.length ?? 0) > 0) {
        console.log(`[priceEngine] sanitized ${data!.length} bad candles for ${cfg.symbol}`);
      }
    } catch (err: any) {
      console.error(`[priceEngine] sanitize ${cfg.symbol} threw:`, err?.message);
    }
  }
}

async function loadHistoryFromDb() {
  const since = Math.floor(Date.now() / 1000) - HISTORY_SEC;
  for (const cfg of ASSETS) {
    try {
      const { data } = await supabaseAdmin
        .from("chart_candles")
        .select("asset,time,open,high,low,close")
        .eq("asset", cfg.symbol)
        .gte("time", since)
        .order("time", { ascending: true })
        .range(0, 30_000);
      if (data && data.length > 0) {
        candles.set(cfg.symbol, data as Candle[]);
        // Seed engine state from the most recent close so the next tick is
        // continuous — but ONLY if the close is within the realistic band.
        // Otherwise snap to base to avoid the chart looking broken.
        const last = data[data.length - 1] as Candle;
        const s = state.get(cfg.symbol);
        const safeLo = cfg.price * (1 - CLAMP_PCT);
        const safeHi = cfg.price * (1 + CLAMP_PCT);
        if (s) {
          if (last.close >= safeLo && last.close <= safeHi) {
            s.price  = last.close;
            s.bucket = last.time;
            s.open   = last.open;
            s.high   = last.high;
            s.low    = last.low;
          } else {
            console.warn(`[priceEngine] ${cfg.symbol} last close ${last.close} out of band — resetting to ${cfg.price}`);
            s.price  = cfg.price;
            s.bucket = last.time;
            s.open   = cfg.price;
            s.high   = cfg.price;
            s.low    = cfg.price;
          }
        }
      } else {
        candles.set(cfg.symbol, []);
      }
    } catch (err: any) {
      console.error(`[priceEngine] history load failed for ${cfg.symbol}:`, err?.message);
      candles.set(cfg.symbol, []);
    }
  }
}

async function pruneOldCandles() {
  const cutoff = Math.floor(Date.now() / 1000) - HISTORY_SEC;
  try {
    // `.select` after `.delete` returns the deleted rows so we can log the count.
    const { data, error } = await supabaseAdmin
      .from("chart_candles")
      .delete()
      .lt("time", cutoff)
      .select("time");
    if (error) {
      console.error("[priceEngine] prune failed:", error.message);
      return;
    }
    const n = data?.length ?? 0;
    if (n > 0) console.log(`[priceEngine] pruned ${n} rows older than ${HISTORY_HOURS}h`);
    // Also drop from in-memory store
    for (const [asset, arr] of candles.entries()) {
      while (arr.length > 0 && arr[0].time < cutoff) arr.shift();
      candles.set(asset, arr);
    }
  } catch (err: any) {
    console.error("[priceEngine] prune threw:", err?.message);
  }
}

/** Fill any time gaps in `candles` (e.g. after server downtime) with synthetic
 *  data so the chart shows a continuous line. Anchors continuity to the last
 *  known close where possible.
 */
function backfillGaps() {
  const now = Math.floor(Date.now() / 1000);
  const startBucket = bucketOf((now - HISTORY_SEC) * 1000);
  const endBucket   = bucketOf(now * 1000) - BASE_CANDLE_SEC;

  for (const cfg of ASSETS) {
    const existing = candles.get(cfg.symbol) ?? [];
    const seen = new Set(existing.map((c) => c.time));
    const filled: Candle[] = [];

    // Build a generator state seeded from existing data if any
    const s = state.get(cfg.symbol)!;
    let anchorPrice = existing.length > 0 ? existing[existing.length - 1].close : cfg.price;

    for (let t = startBucket; t <= endBucket; t += BASE_CANDLE_SEC) {
      if (seen.has(t)) {
        const c = existing.find((c) => c.time === t)!;
        anchorPrice = c.close;
        continue;
      }
      // Synthesize a candle of ~ (BASE_CANDLE_SEC * 1000 / TICK_INTERVAL_MS) ticks
      const stepCount = Math.floor((BASE_CANDLE_SEC * 1000) / TICK_INTERVAL_MS);
      const clampLo = cfg.price * (1 - CLAMP_PCT);
      const clampHi = cfg.price * (1 + CLAMP_PCT);
      let p = anchorPrice;
      let hi = p, lo = p;
      const o = p;
      for (let i = 0; i < stepCount; i++) {
        const randomMove = (Math.random() - 0.5) * cfg.volatility * 2 * VOLATILITY_DAMP;
        const drift      = s.trend * s.trendMag * VOLATILITY_DAMP;
        const reversion  = (cfg.price - p) * REVERSION_RATE;
        p = Math.max(clampLo, Math.min(clampHi, p + randomMove + drift + reversion));
        if (p > hi) hi = p;
        if (p < lo) lo = p;
      }
      p  = round(p,  cfg.decimals);
      hi = round(hi, cfg.decimals);
      lo = round(lo, cfg.decimals);
      filled.push({ asset: cfg.symbol, time: t, open: round(o, cfg.decimals), high: hi, low: lo, close: p });
      anchorPrice = p;
    }

    if (filled.length > 0) {
      const merged = [...existing, ...filled].sort((a, b) => a.time - b.time);
      candles.set(cfg.symbol, merged);
      pendingPersist.push(...filled);
    }

    // ALWAYS advance the engine bucket to the current (open) bucket, even when
    // there were no gaps. Otherwise the next tick re-pushes a candle at the
    // last DB time and breaks the ascending-time invariant on the client.
    const currentBucket = bucketOf(Date.now());
    s.bucket = currentBucket;
    s.open   = anchorPrice;
    s.high   = anchorPrice;
    s.low    = anchorPrice;
    s.price  = anchorPrice;
  }
}

// ── Loop ────────────────────────────────────────────────────────────────────
export function startPriceEngine(
  broadcast: (tick: Tick) => void,
  onBootstrapDone?: () => void,
): () => void {
  // Init state
  const now = Date.now();
  for (const cfg of ASSETS) state.set(cfg.symbol, initState(cfg, now));

  // Async bootstrap: sanitize bad data → load history → backfill gaps →
  // prune → persist. Sanitize runs FIRST so we don't load drifted/poisoned
  // candles into memory.
  (async () => {
    await sanitizeBadHistory();
    await loadHistoryFromDb();
    backfillGaps();
    await pruneOldCandles();
    await flushPendingPersist();
    console.log(`[priceEngine] bootstrap done`);
    onBootstrapDone?.();
  })().catch((e) => console.error("[priceEngine] bootstrap error:", e?.message));

  const persistTimer = setInterval(flushPendingPersist, PERSIST_BATCH_MS);
  const pruneTimer   = setInterval(pruneOldCandles, CLEANUP_INTERVAL_MS);

  const tickTimer = setInterval(async () => {
    const t = Date.now();
    for (const cfg of ASSETS) {
      const s = state.get(cfg.symbol)!;
      const tick = nextTick(cfg, s, t);
      broadcast(tick);

      const arr = tickHistory.get(cfg.symbol) ?? [];
      arr.push(tick);
      if (arr.length > HISTORY_TICK_BUFFER) arr.splice(0, arr.length - HISTORY_TICK_BUFFER);
      tickHistory.set(cfg.symbol, arr);

      // Mirror last price to Redis if configured (non-fatal)
      try {
        await redis.set(KEYS.lastPrice(cfg.symbol), tick);
      } catch {}
    }
  }, TICK_INTERVAL_MS);

  return () => {
    clearInterval(tickTimer);
    clearInterval(persistTimer);
    clearInterval(pruneTimer);
    // Final flush on shutdown
    flushPendingPersist().catch(() => {});
  };
}
