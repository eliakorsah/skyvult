"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import TradePanel from "@/components/TradePanel";
import OpenTrades from "@/components/OpenTrades";
import MobileTradeBar from "@/components/MobileTradeBar";
import ResultPopup, { ResultData } from "@/components/ResultPopup";
import WinStreakPopup from "@/components/WinStreakPopup";
import type { ChartHandle } from "@/components/Chart";
import { useSocket, Tick, ServerMessage } from "@/lib/socket";
import { api } from "@/lib/api";
import { getPayoutRatio, ASSET_CONFIGS } from "@/lib/assets";
import { AnimatePresence, motion } from "framer-motion";
import { useSession } from "@/lib/sessionContext";
import OnboardingTour from "@/components/OnboardingTour";

const Chart = dynamic(() => import("@/components/Chart"), { ssr: false });

const ASSETS = ["EUR/USD", "GBP/USD", "BTC/USD", "GOLD", "OIL", "ETH/USD"];

export default function TradePage() {
  // DEMO/REAL mode now comes from the shared SessionProvider in
  // app/(authed)/layout.tsx, so the toggle in the Nav and the trading UI
  // both read/write the same source of truth across navigations.
  const { isDemo, setIsDemo, setLiveBalance } = useSession();
  const [asset, setAsset] = useState("EUR/USD");
  const [ticksByAsset, setTicksByAsset] = useState<Record<string, Tick[]>>({});
  const [openTrades, setOpenTrades] = useState<any[]>([]);
  const [balance, setBalance] = useState({ real: 0, demo: 0 });
  const [result, setResult] = useState<ResultData | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [showStreakPopup, setShowStreakPopup] = useState(false);
  const winStreakRef = useRef(0);
  const isDemoRef = useRef(isDemo);
  isDemoRef.current = isDemo;
  const accessRef   = useRef<string | null>(null);
  function playSound(src: string) {
    try { new Audio(src).play().catch(() => {}); } catch {}
  }
  // Imperative handle into the chart — used to push live ticks directly,
  // bypassing React's render cycle for smooth in-progress candle painting.
  const chartRef = useRef<ChartHandle | null>(null);

  // Shared trade-config state so the chart preview (TP/SL lines + BUY/SELL
  // overlay), the mobile trade bar, and the desktop side panel all read and
  // write the same amount/expiry. Without this, the overlay's preview lines
  // would drift from what the bottom bar shows.
  const [amount, setAmount] = useState(10);  // matches RISK.MIN_TRADE
  const [expiry, setExpiry] = useState(60);

  useEffect(() => {
    if (typeof window !== "undefined") {
      accessRef.current = localStorage.getItem("skyvult_access");
    }
  }, []);

  const refreshTrades = useCallback(async () => {
    try { const d = await api<{ trades: any[] }>("/api/trades/open"); setOpenTrades(d.trades); } catch {}
  }, []);

  const refreshBalance = useCallback(async () => {
    try {
      const w = await api<{ balance: number; demoBalance: number }>("/api/wallet");
      setBalance({ real: w.balance, demo: w.demoBalance });
    } catch {}
  }, []);

  useEffect(() => {
    refreshTrades(); refreshBalance();

    // Slow polling when tab is hidden; full speed when visible.
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      refreshTrades(); refreshBalance();
    };
    const i = setInterval(tick, 2000);

    function onVisible() {
      if (document.visibilityState === "visible") { refreshTrades(); refreshBalance(); }
    }
    document.addEventListener("visibilitychange", onVisible);

    return () => { clearInterval(i); document.removeEventListener("visibilitychange", onVisible); };
  }, [refreshTrades, refreshBalance]);

  // Refresh the demo wallet from the mobile bar's CTA. Same endpoint as the
  // avatar-menu button — server caps at 4/min/user so the button being on the
  // bar can't be abused.
  const refreshDemoBalance = useCallback(async () => {
    try {
      await api("/api/wallet/demo-reset", { method: "POST" });
      refreshBalance();
    } catch {}
  }, [refreshBalance]);

  const onMessage = useCallback((msg: ServerMessage) => {
    if (msg.type === "snapshot") {
      setTicksByAsset((p) => ({ ...p, [msg.asset]: msg.ticks }));
    } else if (msg.type === "price") {
      // Fast path: push the tick straight into the chart for smooth 20fps
      // in-progress candle painting (bypasses React's render cycle).
      chartRef.current?.pushTick(msg.tick);
      setTicksByAsset((p) => {
        const arr = p[msg.tick.asset] ? [...p[msg.tick.asset], msg.tick] : [msg.tick];
        if (arr.length > 500) arr.splice(0, arr.length - 500);
        return { ...p, [msg.tick.asset]: arr };
      });
    } else if (msg.type === "trade-result") {
      if (msg.status === "WON") {
        playSound("/win.mp3");
        winStreakRef.current += 1;
        if (winStreakRef.current >= 3 && isDemoRef.current) {
          setShowStreakPopup(true);
          winStreakRef.current = 0;
        }
      } else if (msg.status === "LOST") {
        playSound("/loss.mp3");
        winStreakRef.current = 0;
      } else {
        winStreakRef.current = 0;
      }
      setResult({ status: msg.status, payout: msg.payout, exitPrice: msg.exitPrice });
      refreshTrades(); refreshBalance();
    }
  }, [refreshTrades, refreshBalance]);

  const { connected } = useSocket({ token: accessRef.current, onMessage });
  const ticks = ticksByAsset[asset] || [];
  const lastPrice = ticks[ticks.length - 1]?.price ?? null;
  const walletBalance = isDemo ? balance.demo : balance.real;
  const currentPayoutRatio = getPayoutRatio(asset);

  // MetaTrader-style floating equity: wallet balance + mark-to-market value
  // of every OPEN trade for the current mode. Each trade's position value
  // moves linearly between 0 (at SL — total loss) and amount × PAYOUT_RATIO
  // (at TP — full payout), passing through `amount` at the entry price.
  // Result: as candles rise/fall, the header balance updates live.
  const liveBalance = useMemo(() => {
    let equity = walletBalance;
    for (const t of openTrades) {
      if (!!t.isDemo !== !!isDemo) continue;
      if (t.tpPrice == null || t.slPrice == null) continue;
      const tArr = ticksByAsset[t.asset];
      const price = tArr && tArr.length > 0 ? tArr[tArr.length - 1].price : Number(t.entryPrice);
      const distance = Math.abs(Number(t.tpPrice) - Number(t.entryPrice));
      if (distance === 0) { equity += Number(t.amount); continue; }
      let progress = (price - Number(t.entryPrice)) / distance;
      if (t.direction === "DOWN") progress = -progress;
      if (progress > 1)  progress = 1;
      if (progress < -1) progress = -1;
      const amt = Number(t.amount);
      const tradePayoutRatio = getPayoutRatio(t.asset);
      const positionValue = progress >= 0
        ? amt * (1 + progress * (tradePayoutRatio - 1))
        : amt * (1 + progress);
      equity += positionValue;
    }
    return equity;
  }, [walletBalance, openTrades, isDemo, ticksByAsset]);

  // Push MTM equity to SessionContext at ~4fps so the Nav header balance
  // updates live as candles move — without flooding context at 20fps.
  const liveBalanceRef = useRef(liveBalance);
  liveBalanceRef.current = liveBalance;
  useEffect(() => {
    setLiveBalance(liveBalanceRef.current);
    const id = setInterval(() => setLiveBalance(liveBalanceRef.current), 250);
    return () => clearInterval(id);
  }, [setLiveBalance]);

  // Stamp each OPEN trade with its *projected* payout (DB stores 0 until
  // resolution). The chart uses this for the TP price-line label, so the
  // user sees "TP +₵73" instead of "TP +₵0" while the round is alive.
  // useMemo so the array reference is stable across the 20Hz tick re-renders
  // — Chart's open-trades effect deps on this; without memoization it would
  // rebuild every trade's price lines on each tick.
  const openTradesView = useMemo(() => openTrades.map((t) => ({
    ...t,
    payout: t.payout && t.payout > 0 ? t.payout : Math.round(Number(t.amount) * getPayoutRatio(t.asset)),
  })), [openTrades]);


  return (
    <main className="h-full flex flex-col overflow-hidden">
      <OnboardingTour />
      {/* Asset tabs */}
      <div data-tour="assets" className="px-3 py-2 border-b border-border bg-panel flex items-center gap-1 overflow-x-auto flex-shrink-0 scrollbar-none">
        {ASSETS.map((a) => {
          const lp = ticksByAsset[a]?.[ticksByAsset[a].length - 1];
          return (
            <button key={a} onClick={() => setAsset(a)}
              className={`tab whitespace-nowrap text-xs flex-shrink-0 ${asset === a ? "tab-active" : "tab-idle"}`}>
              {a}
              <span className="ml-1 opacity-70 font-mono">{lp?.price?.toFixed(prec(a)) ?? "--"}</span>
            </button>
          );
        })}
        <span className="ml-auto flex-shrink-0 text-xs pl-2">
          {connected
            ? <span className="text-up">● live</span>
            : <span className="text-down">● …</span>}
        </span>
      </div>

      {/* Main area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Chart fills available space. On mobile, leave ~220px at the bottom
            so candles don't render behind the MobileTradeBar — keeps the live
            candle visible at all times. Desktop layout activates at md (768px)
            so the chart stops at the bottom and the side rail takes the right. */}
        <div data-tour="chart" className="absolute top-0 left-0 right-0 chart-area-mobile md:bottom-0 md:right-[300px] overflow-hidden">
          {/* Hero image */}
          <div
            className="absolute inset-0 bg-cover bg-center bg-no-repeat"
            style={{ backgroundImage: "url('/hero.jpg')", opacity: 0.7 }}
          />
          {/* Dark gradient overlay — dims the image so candles stay readable */}
          <div className="absolute inset-0 bg-gradient-to-b from-bg/80 via-bg/60 to-bg/80" />
          <Chart
            asset={asset}
            ticks={ticks}
            openTrades={openTradesView}
            onHandle={(h) => { chartRef.current = h; }}
          />
        </div>

        {/* Mobile: persistent buy/sell bar at the bottom of the chart */}
        <MobileTradeBar
          asset={asset}
          isDemo={isDemo}
          balance={liveBalance}
          onPlaced={() => { refreshTrades(); refreshBalance(); }}
          onDemoRefresh={refreshDemoBalance}
          amount={amount}
          setAmount={setAmount}
          expiry={expiry}
          setExpiry={setExpiry}
          payoutRatio={currentPayoutRatio}
        />

        {/* Mobile: floating button to view open trades list */}
        {openTrades.length > 0 && (
          <button
            onClick={() => setSidebarOpen(true)}
            className="md:hidden absolute top-12 right-3 z-20 bg-panel/95 backdrop-blur border border-accent/40 text-accent text-xs font-semibold rounded-full px-3 py-1.5 shadow-lg"
          >
            {openTrades.length} open ▾
          </button>
        )}

        {/* Desktop trading rail — trade controls pinned at top, open trades scroll below */}
        <aside className="hidden md:flex flex-col absolute top-0 right-0 h-full w-[300px] bg-bg/95 border-l border-border">
          <div className="flex-shrink-0 p-3 border-b border-border">
            <TradePanel
              asset={asset}
              currentPrice={lastPrice}
              isDemo={isDemo}
              balance={liveBalance}
              onPlaced={() => { refreshTrades(); refreshBalance(); }}
              amount={amount}
              setAmount={setAmount}
              expiry={expiry}
              setExpiry={setExpiry}
              payoutRatio={currentPayoutRatio}
            />
          </div>
          <div className="flex-1 overflow-y-auto p-3">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-2">
              Open trades {openTrades.length > 0 && <span className="text-accent">({openTrades.length})</span>}
            </div>
            <OpenTrades trades={openTrades} />
          </div>
        </aside>
      </div>

      {/* Mobile slide-up sheet — shows the open-trades list when the floating
          chip is tapped. Trade execution itself happens in MobileTradeBar. */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.div
            className="md:hidden fixed inset-0 z-40 flex flex-col justify-end"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={() => setSidebarOpen(false)}
          >
            <motion.div
              className="bg-bg border-t border-border rounded-t-2xl p-4 flex flex-col gap-4 max-h-[70dvh] overflow-y-auto"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", stiffness: 320, damping: 32, mass: 0.8 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="w-10 h-1 bg-border rounded-full mx-auto mb-1" />
              <div className="text-sm font-semibold">Open trades</div>
              <OpenTrades trades={openTrades} />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <ResultPopup result={result} onClose={() => setResult(null)} />
      <AnimatePresence>
        {showStreakPopup && (
          <WinStreakPopup
            onSwitchToReal={() => { setShowStreakPopup(false); setIsDemo(false); }}
            onDismiss={() => setShowStreakPopup(false)}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function prec(a: string) { return ASSET_CONFIGS[a]?.decimals ?? 2; }
