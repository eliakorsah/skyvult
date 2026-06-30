"use client";

import { useEffect, useRef, useState } from "react";
import {
  createChart, ColorType, CrosshairMode, LineStyle,
  IChartApi, ISeriesApi, UTCTimestamp, CandlestickData, IPriceLine,
} from "lightweight-charts";
import type { Tick, Candle } from "@/lib/socket";
import { ASSET_CONFIGS } from "@/lib/assets";

export type OpenTradeView = {
  id: string;
  asset: string;
  direction: "UP" | "DOWN";
  entryPrice: number;
  expiresAt: string;       // ISO timestamp
  tpPrice?: number | null; // populated when the trade was created with price-touch settlement
  slPrice?: number | null;
  amount?: number;
  payout?: number;         // projected if WON; surfaced on the TP label
};

/** Imperative handle exposed via the `onHandle` callback prop so the parent
 *  can push live ticks directly into the chart, bypassing React's render
 *  cycle. We use a callback prop rather than forwardRef because next/dynamic
 *  doesn't reliably forward refs through its wrapper component. */
export type ChartHandle = {
  pushTick: (tick: Tick) => void;
};

const TIMEFRAMES = [
  { label: "5s",  s: 5   },
  { label: "15s", s: 15  },
  { label: "30s", s: 30  },
  { label: "1m",  s: 60  },
  { label: "5m",  s: 300 },
];

export type ChartType = "candles" | "line" | "area";

const CHART_TYPES: { type: ChartType; label: string; icon: string }[] = [
  { type: "candles", label: "Candles", icon: "▥" },
  { type: "line",    label: "Line",    icon: "〰" },
  { type: "area",    label: "Area",    icon: "◣" },
];

// Line/Area series carry a single value per point; candles carry OHLC.
// These adapters let the rest of the chart logic keep working in OHLC terms
// (we always track the in-progress candle) and convert at the series boundary.
type LinePoint = { time: UTCTimestamp; value: number };
function toSeriesData(data: CandlestickData[], type: ChartType): CandlestickData[] | LinePoint[] {
  if (type === "candles") return data;
  return data.map((c) => ({ time: c.time as UTCTimestamp, value: c.close }));
}
function toSeriesPoint(c: CandlestickData, type: ChartType): CandlestickData | LinePoint {
  return type === "candles" ? c : { time: c.time as UTCTimestamp, value: c.close };
}

const SAVE_DEBOUNCE_MS = 1500;
// Bumping the version invalidates any sessionStorage cache from earlier
// (buggy) builds. Increment whenever the price model or candle shape changes.
const CACHE_VERSION = "v2";
const cacheKey = (asset: string, tf: number) => `skyvult:chart:${CACHE_VERSION}:${asset}:${tf}`;

// Sanity-check expected price range per asset so a stale cache from a
// drifted earlier run can't poison the chart. Matches the server's CLAMP_PCT.
const ASSET_BASE: Record<string, number> = {
  "SVX Prime":    1.085,
  "SVX Alpha":    1.272,
  "SVX Titan":    67420,
  "SVX Quantum":  3540,
  "SVX Velocity": 2341,
  "SVX Nova":     78.4,
};
function isCacheSane(asset: string, candles: CandlestickData[]): boolean {
  const base = ASSET_BASE[asset];
  if (!base || candles.length === 0) return true;
  const lo = base * 0.7;
  const hi = base * 1.3;
  for (const c of candles) {
    if (c.low < lo || c.high > hi) return false;
  }
  return true;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Aggregate 5s base candles into a larger timeframe by grouping. Always
 *  returns strictly ascending, deduplicated candles — lightweight-charts
 *  asserts on this and throws if not.
 *
 *  Also forward-fills time gaps (server downtime / failed persists) with
 *  flat doji candles using the previous close. Without this, missing
 *  buckets show as ugly empty space in the middle of the chart whenever
 *  the price engine was offline. */
function aggregate(candles: Candle[], tfSeconds: number): CandlestickData[] {
  const map = new Map<number, CandlestickData>();
  for (const c of candles) {
    const bucket = (Math.floor(c.time / tfSeconds) * tfSeconds) as UTCTimestamp;
    const existing = map.get(bucket as number);
    if (!existing) {
      map.set(bucket as number, {
        time:  bucket,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      });
    } else {
      if (c.high > existing.high) existing.high = c.high;
      if (c.low  < existing.low)  existing.low  = c.low;
      existing.close = c.close;
    }
  }
  const sorted = [...map.values()].sort((a, b) => (a.time as number) - (b.time as number));
  if (sorted.length < 2) return sorted;

  // Forward-fill missing buckets with flat candles (open=high=low=close=prev close).
  // Cap how many we synthesize so a multi-day gap doesn't balloon the array.
  const MAX_FILL = 5000;
  const out: CandlestickData[] = [sorted[0]];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const curr = sorted[i];
    const prevT = prev.time as number;
    const currT = curr.time as number;
    const gap   = currT - prevT;
    if (gap > tfSeconds) {
      const missing = Math.min(MAX_FILL, Math.floor(gap / tfSeconds) - 1);
      for (let k = 1; k <= missing; k++) {
        const t = (prevT + k * tfSeconds) as UTCTimestamp;
        out.push({ time: t, open: prev.close, high: prev.close, low: prev.close, close: prev.close });
      }
    }
    out.push(curr);
  }
  return out;
}

function loadCache(asset: string, tf: number): CandlestickData[] {
  try {
    const raw = sessionStorage.getItem(cacheKey(asset, tf));
    if (!raw) return [];
    const data = JSON.parse(raw) as CandlestickData[];
    if (!isCacheSane(asset, data)) {
      // Purge — prices are out of the realistic band, likely from a buggy run
      sessionStorage.removeItem(cacheKey(asset, tf));
      return [];
    }
    return data;
  } catch { return []; }
}

function saveCache(asset: string, tf: number, candles: CandlestickData[]) {
  try {
    sessionStorage.setItem(cacheKey(asset, tf), JSON.stringify(candles.slice(-2000)));
  } catch {}
}

/** Bridge the gap between the most-recent historical candle and "now" using
 *  the live tick buffer. Without this, a fresh history fetch lags the live
 *  feed by up to (persist_batch + cache_refresh) seconds, leaving a visible
 *  empty area on the right side of the chart — especially after TF changes.
 */
function bridgeWithTicks(
  history: CandlestickData[],
  ticks: Tick[],
  tfSec: number,
): CandlestickData[] {
  if (ticks.length === 0) return history;
  const lastHistTime = history.length > 0 ? (history[history.length - 1].time as number) : 0;
  const newBuckets = new Map<number, CandlestickData>();
  for (const t of ticks) {
    const bucket = Math.floor(t.timestamp / 1000 / tfSec) * tfSec;
    if (bucket <= lastHistTime) continue; // already in history
    const existing = newBuckets.get(bucket);
    if (!existing) {
      newBuckets.set(bucket, {
        time:  bucket as UTCTimestamp,
        open:  t.price,
        high:  t.price,
        low:   t.price,
        close: t.price,
      });
    } else {
      if (t.price > existing.high) existing.high = t.price;
      if (t.price < existing.low)  existing.low  = t.price;
      existing.close = t.price;
    }
  }
  if (newBuckets.size === 0) return history;
  const bridged = [...history, ...[...newBuckets.values()].sort(
    (a, b) => (a.time as number) - (b.time as number),
  )];
  return bridged;
}

// ─── component ────────────────────────────────────────────────────────────────

type ChartProps = {
  asset: string;
  ticks: Tick[];
  openTrades?: OpenTradeView[];
  onHandle?: (handle: ChartHandle | null) => void;
};

export default function Chart({
  asset, ticks, openTrades = [], onHandle,
}: ChartProps) {
  // Historical candles fetched directly from Supabase via /api/chart/history.
  // WebSocket is used only for live tick updates (paints the in-progress candle).
  const [historyCandles, setHistoryCandles] = useState<Candle[]>([]);
  const containerRef    = useRef<HTMLDivElement>(null);
  const chartRef        = useRef<IChartApi | null>(null);
  const seriesRef       = useRef<ISeriesApi<"Candlestick" | "Line" | "Area"> | null>(null);

  const liveCandle      = useRef<CandlestickData | null>(null);
  const lastTsRef       = useRef<number>(0);
  const assetRef        = useRef<string>("");
  const tfRef           = useRef<number>(5);
  const userPannedRef   = useRef<boolean>(false);
  const programmaticRef = useRef<boolean>(false);
  const saveTimerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seededFromHistoryRef = useRef<string>(""); // `${asset}:${tf}` last seeded
  // Map of trade.id → its trio of price lines (entry, TP, SL). All three are
  // created/updated/removed atomically so an open trade leaves no orphaned
  // lines behind after it settles.
  type TradeLines = { entry: IPriceLine; tp?: IPriceLine; sl?: IPriceLine };
  const tradeLinesRef = useRef<Map<string, TradeLines>>(new Map());

  const [tf, setTf] = useState(5);
  const [chartType, setChartType] = useState<ChartType>("candles");
  const chartTypeRef = useRef<ChartType>("candles");
  // Bumped whenever the series is recreated (chart-type switch) so the
  // seeding and trade-line effects re-run against the new series instance.
  const [seriesEpoch, setSeriesEpoch] = useState(0);

  // Fetch history from Supabase whenever the asset changes. Refresh every
  // 60s so the chart stays in sync if the WS misses ticks. Live ticks paint
  // the in-progress candle on top of this server-side data.
  useEffect(() => {
    let alive = true;
    const fetchHistory = async () => {
      try {
        const res = await fetch(`/api/chart/history?asset=${encodeURIComponent(asset)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        if (!alive) return;
        const candles: Candle[] = (json.candles || []).map((c: any) => ({
          time:  c.time,
          open:  c.open,
          high:  c.high,
          low:   c.low,
          close: c.close,
        }));
        setHistoryCandles(candles);
      } catch (err) {
        if (!alive) return;
        console.error("[chart] history fetch failed", err);
      }
    };
    fetchHistory();
    const refresh = setInterval(fetchHistory, 60_000);
    // Re-fetch immediately when the tab becomes visible so lines are restored
    // without waiting up to 60s for the next scheduled tick.
    const onVisible = () => { if (document.visibilityState === "visible") fetchHistory(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { alive = false; clearInterval(refresh); document.removeEventListener("visibilitychange", onVisible); };
  }, [asset]);

  function debouncedSave(asset: string, tf: number, data: CandlestickData[]) {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveCache(asset, tf, data), SAVE_DEBOUNCE_MS);
  }

  function programmaticScroll() {
    if (!chartRef.current) return;
    programmaticRef.current = true;
    chartRef.current.timeScale().scrollToRealTime();
    setTimeout(() => { programmaticRef.current = false; }, 0);
  }

  // Always show roughly the last ~80 candles, regardless of total history,
  // so the chart looks consistent across timeframes / data sizes.
  function programmaticDefaultView() {
    if (!chartRef.current) return;
    programmaticRef.current = true;
    const ts = chartRef.current.timeScale();
    ts.applyOptions({ barSpacing: 10, rightOffset: 8 });
    ts.scrollToRealTime();
    setTimeout(() => { programmaticRef.current = false; }, 0);
  }

  // ── create chart once ────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: "#9aa3b5",
        fontSize: 11,
        fontFamily: "ui-monospace, SFMono-Regular, monospace",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: "#2c3340", style: 1 },
        horzLines: { color: "#2c3340", style: 1 },
      },
      rightPriceScale: {
        borderColor: "#3a4454",
        // Tight margins so even small price moves take up real vertical space
        scaleMargins: { top: 0.05, bottom: 0.05 },
        entireTextOnly: true,
        // Starts auto-scaled; dragging up/down on the price axis switches this
        // off and lets the user set the vertical scale manually. Double-tapping
        // the price axis resets it back to auto.
        autoScale: true,
      },
      leftPriceScale: { visible: false },
      timeScale: {
        borderColor: "#3a4454",
        timeVisible: true,
        secondsVisible: true,
        rightOffset: 8,
        barSpacing: 10,
        minBarSpacing: 2,
        fixLeftEdge: false,
        lockVisibleTimeRangeOnResize: false,
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: "#4a5668", width: 1, style: 3, labelBackgroundColor: "#3a4454" },
        horzLine: { color: "#4a5668", width: 1, style: 3, labelBackgroundColor: "#3a4454" },
      },
      autoSize: true,
      // Panning the chart body stays horizontal-only (so a vertical swipe to
      // scroll the page isn't hijacked). Vertical scaling is done by dragging
      // up/down ON the price axis — see handleScale.axisPressedMouseMove.price.
      handleScroll: {
        mouseWheel: true,         // wheel scrolls time horizontally
        pressedMouseMove: true,   // click+drag pans time
        horzTouchDrag: true,      // mobile: horizontal swipe pans time
        vertTouchDrag: false,     // mobile: vertical swipe does NOT pan the body
      },
      handleScale: {
        // price: drag up/down on the price axis to stretch/compress the
        // vertical scale (adjusts how tall the candles/line appear). Works with
        // mouse drag and touch-drag on the axis. Double-tap the axis to reset.
        axisPressedMouseMove: { time: true, price: true },
        axisDoubleClickReset: { time: true, price: true },
        mouseWheel: true,
        pinch: true,
      },
    });

    chartRef.current  = chart;

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
      if (programmaticRef.current) return;
      userPannedRef.current = true;
    });

    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      chart.remove();
      chartRef.current  = null;
      seriesRef.current = null;
    };
  }, []);

  // ── (re)create the series whenever the chart type changes ────────────────
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Tear down the previous series (and any trade lines that lived on it).
    if (seriesRef.current) {
      try { chart.removeSeries(seriesRef.current); } catch {}
      seriesRef.current = null;
      tradeLinesRef.current.clear();
    }

    let series: ISeriesApi<"Candlestick" | "Line" | "Area">;
    if (chartType === "line") {
      series = chart.addLineSeries({
        color: "#f7a600",
        lineWidth: 2,
        priceLineVisible: true,
        priceLineWidth:   1,
        priceLineColor:   "#f7a600",
        priceLineStyle:   2,
        lastValueVisible: true,
      });
    } else if (chartType === "area") {
      series = chart.addAreaSeries({
        lineColor:   "#f7a600",
        topColor:    "rgba(247,166,0,0.35)",
        bottomColor: "rgba(247,166,0,0.02)",
        lineWidth: 2,
        priceLineVisible: true,
        priceLineWidth:   1,
        priceLineColor:   "#f7a600",
        priceLineStyle:   2,
        lastValueVisible: true,
      });
    } else {
      series = chart.addCandlestickSeries({
        upColor:         "#26a69a",
        downColor:       "#ef5350",
        borderUpColor:   "#26a69a",
        borderDownColor: "#ef5350",
        wickUpColor:     "#26a69a",
        wickDownColor:   "#ef5350",
        priceLineVisible: true,
        priceLineWidth:   1,
        priceLineColor:   "#f7a600",
        priceLineStyle:   2,
        lastValueVisible: true,
      });
    }

    seriesRef.current  = series;
    chartTypeRef.current = chartType;
    // Force the seeding + trade-line effects to repopulate the new series.
    seededFromHistoryRef.current = "";
    setSeriesEpoch((e) => e + 1);
  }, [chartType]);

  // ── seed from history + cache when asset/TF changes or history arrives ───
  useEffect(() => {
    if (!seriesRef.current) return;
    assetRef.current = asset;
    tfRef.current    = tf;

    const decimals = ASSET_CONFIGS[asset]?.decimals ?? 2;
    seriesRef.current.applyOptions({
      priceFormat: { type: "price", precision: decimals, minMove: Math.pow(10, -decimals) },
    });

    // Prefer fresh history from server; fall back to cached candles for instant display
    const source = historyCandles.length > 0 ? historyCandles : null;
    let data: CandlestickData[];
    if (source) {
      data = aggregate(source, tf);
    } else {
      data = loadCache(asset, tf);
    }
    // Fill any gap between historical end and "now" using the live tick buffer
    data = bridgeWithTicks(data, ticks, tf);

    programmaticRef.current = true;
    seriesRef.current.setData(toSeriesData(data, chartType) as any);
    liveCandle.current = data[data.length - 1] ?? null;
    // Set lastTsRef so live ticks beyond historical data trigger incremental updates
    const lastCandleTimeMs = data.length > 0 ? (data[data.length - 1].time as number) * 1000 : 0;
    lastTsRef.current = lastCandleTimeMs;
    programmaticDefaultView();
    userPannedRef.current = false;

    if (data.length > 0) debouncedSave(asset, tf, data);

    seededFromHistoryRef.current = `${asset}:${tf}:${historyCandles.length}`;
  }, [asset, tf, historyCandles, seriesEpoch]); // eslint-disable-line react-hooks/exhaustive-deps

  // Apply one tick to the in-progress candle. Exposed via useImperativeHandle
  // so the parent can call this directly from the WS message handler, bypassing
  // React's render cycle for smooth 20fps updates on mobile.
  function applyTick(tick: Tick) {
    if (!seriesRef.current) return;
    if (assetRef.current !== tick.asset) return;

    const tfSec = tfRef.current;
    const bucket = (Math.floor(tick.timestamp / 1000 / tfSec) * tfSec) as UTCTimestamp;

    // Forward-fill any missing buckets between the last drawn candle and the
    // incoming tick's bucket. This happens after tab switches (chart re-seeds
    // from Supabase, which lags by up to one persist-batch interval) and after
    // brief disconnects. Cap the fill to avoid a runaway after long downtime.
    const prevForFill = liveCandle.current;
    if (prevForFill) {
      const prevT = prevForFill.time as number;
      const currT = bucket as number;
      const missing = Math.floor((currT - prevT) / tfSec) - 1;
      if (missing > 0 && missing <= 200) {
        for (let k = 1; k <= missing; k++) {
          const t = (prevT + k * tfSec) as UTCTimestamp;
          const fill: CandlestickData = {
            time: t,
            open:  prevForFill.close,
            high:  prevForFill.close,
            low:   prevForFill.close,
            close: prevForFill.close,
          };
          try { seriesRef.current.update(toSeriesPoint(fill, chartTypeRef.current) as any); } catch { /* out-of-order, skip */ }
        }
      }
    }

    let updated: CandlestickData;
    const prev = liveCandle.current;
    const isNewBar = !prev || (prev.time as number) !== (bucket as number);
    if (!isNewBar && prev) {
      updated = {
        time:  bucket,
        open:  prev.open,
        high:  Math.max(prev.high, tick.price),
        low:   Math.min(prev.low,  tick.price),
        close: tick.price,
      };
    } else {
      updated = { time: bucket, open: tick.price, high: tick.price, low: tick.price, close: tick.price };
    }

    try {
      seriesRef.current.update(toSeriesPoint(updated, chartTypeRef.current) as any);
    } catch {
      // Out-of-order time — next history snapshot will repair it.
      return;
    }
    liveCandle.current = updated;
    lastTsRef.current  = tick.timestamp;

    // Only auto-follow when a NEW bar appears; in-bucket updates redraw in
    // place and don't need a scroll (calling scrollToRealTime 20×/sec on
    // mobile causes visible jank that masks the candle's price movement).
    if (isNewBar && !userPannedRef.current) programmaticScroll();
  }

  // Register the imperative handle with the parent via callback prop.
  // This works even when the component is loaded through next/dynamic
  // (which doesn't forward refs through its wrapper).
  useEffect(() => {
    if (!onHandle) return;
    onHandle({ pushTick: applyTick });
    return () => onHandle(null);
  }, [onHandle]);

  // Fallback path: also drive updates from the ticks prop. The parent uses
  // pushTick() as the fast path, but this keeps the chart in sync if the
  // imperative handle hasn't been wired up (or for the very first tick after
  // mount before the ref is attached).
  useEffect(() => {
    if (ticks.length === 0) return;
    const last = ticks[ticks.length - 1];
    if (last) applyTick(last);
  }, [ticks, asset]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── manage entry-price lines for open trades on this asset ───────────────
  useEffect(() => {
    if (!seriesRef.current) return;
    const series = seriesRef.current;

    const relevant = openTrades.filter((t) => t.asset === asset);
    const seen = new Set(relevant.map((t) => t.id));

    // Remove all three lines (entry + tp + sl) for trades no longer open
    for (const [id, lines] of tradeLinesRef.current.entries()) {
      if (!seen.has(id)) {
        try { series.removePriceLine(lines.entry); } catch {}
        if (lines.tp) { try { series.removePriceLine(lines.tp); } catch {} }
        if (lines.sl) { try { series.removePriceLine(lines.sl); } catch {} }
        tradeLinesRef.current.delete(id);
      }
    }

    // Inner render function — also used by the 1s ticker below for countdown
    const render = () => {
      for (const t of relevant) {
        const msLeft = new Date(t.expiresAt).getTime() - Date.now();
        const sec = Math.max(0, Math.ceil(msLeft / 1000));
        const color = t.direction === "UP" ? "#26a69a" : "#ef5350";
        const arrow = t.direction === "UP" ? "▲" : "▼";
        const entryTitle = `${arrow} ${t.direction} · ${sec}s`;
        const tpTitle = t.payout != null ? `TP +₵${t.payout.toLocaleString()}` : "TP";
        const slTitle = t.amount != null ? `SL −₵${t.amount.toLocaleString()}` : "SL";

        let existing = tradeLinesRef.current.get(t.id);
        if (!existing) {
          // Fresh trade — create the entry line (always) plus TP/SL lines if
          // the trade carries those prices (legacy trades without them just
          // get the entry line + direction-at-expiry settlement).
          const entry = series.createPriceLine({
            price: t.entryPrice,
            color,
            lineWidth: 2,
            lineStyle: LineStyle.Dashed,
            axisLabelVisible: true,
            title: entryTitle,
          });
          const tp = t.tpPrice != null ? series.createPriceLine({
            price: t.tpPrice,
            color: "#26a69a",
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: tpTitle,
          }) : undefined;
          const sl = t.slPrice != null ? series.createPriceLine({
            price: t.slPrice,
            color: "#ef5350",
            lineWidth: 2,
            lineStyle: LineStyle.Solid,
            axisLabelVisible: true,
            title: slTitle,
          }) : undefined;
          existing = { entry, tp, sl };
          tradeLinesRef.current.set(t.id, existing);
        } else {
          // Existing trade — just refresh the countdown on the entry label.
          existing.entry.applyOptions({ title: entryTitle, color });
        }
      }
    };

    render();
    // 1s ticker keeps the countdown label fresh
    const i = setInterval(render, 1000);
    return () => clearInterval(i);
  }, [openTrades, asset, seriesEpoch]);

  // TP/SL lines are only shown after the trade is committed — see the
  // open-trades effect above which creates them per-trade with solid styling.
  // The pre-commit preview lines were removed so the chart stays uncluttered
  // until the user actually places the round.

  return (
    <div className="w-full h-full flex flex-col">
      {/* Timeframe + chart-type bar — sits above the chart so it's never obscured */}
      <div className="flex-shrink-0 flex items-center gap-1 px-2 py-1.5 border-b border-border bg-bg/80 backdrop-blur-sm">
        {TIMEFRAMES.map((t) => (
          <button
            key={t.s}
            onClick={() => { setTf(t.s); userPannedRef.current = false; }}
            className={`text-[11px] px-2.5 py-1 rounded font-semibold transition-colors touch-manipulation select-none ${
              tf === t.s
                ? "bg-accent text-black"
                : "bg-panel2 text-muted hover:text-white border border-border"
            }`}
          >
            {t.label}
          </button>
        ))}

        {/* Chart-type switcher, pushed to the right */}
        <div className="ml-auto flex items-center gap-1">
          {CHART_TYPES.map((c) => (
            <button
              key={c.type}
              onClick={() => setChartType(c.type)}
              title={c.label}
              aria-label={c.label}
              aria-pressed={chartType === c.type}
              className={`text-[12px] leading-none w-7 h-7 flex items-center justify-center rounded font-semibold transition-colors touch-manipulation select-none ${
                chartType === c.type
                  ? "bg-accent text-black"
                  : "bg-panel2 text-muted hover:text-white border border-border"
              }`}
            >
              {c.icon}
            </button>
          ))}
        </div>
      </div>

      {/* Chart fills remaining height */}
      <div className="relative flex-1 min-h-0">
        <div ref={containerRef} className="w-full h-full" style={{ touchAction: "pan-x pinch-zoom" }} />
        <button
          onClick={() => {
            userPannedRef.current = false;
            programmaticScroll();
          }}
          className="absolute bottom-2 right-2 z-10 text-[11px] px-2.5 py-1 rounded font-semibold bg-accent/90 text-black hover:bg-accent touch-manipulation select-none shadow-lg"
          title="Jump to latest"
        >
          ⤓ Live
        </button>
      </div>
    </div>
  );
}
