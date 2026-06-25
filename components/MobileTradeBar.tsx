"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "@/lib/api";
import { RISK } from "@/lib/assets";
const EXPIRIES = [
  { s: 5,   label: "5s"  },
  { s: 30,  label: "30s" },
  { s: 60,  label: "1m"  },
  { s: 120, label: "2m"  },
  { s: 180, label: "3m"  },
  { s: 300, label: "5m"  },
];
const QUICK_AMOUNTS = [10, 20, 50, 100];

export default function MobileTradeBar({
  asset,
  isDemo,
  balance,
  onPlaced,
  onDemoRefresh,
  amount,
  setAmount,
  expiry,
  setExpiry,
  payoutRatio,
}: {
  asset: string;
  isDemo: boolean;
  balance: number;
  onPlaced: () => void;
  onDemoRefresh?: () => void;
  amount: number;
  setAmount: (v: number) => void;
  expiry: number;
  setExpiry: (v: number) => void;
  payoutRatio: number;
}) {
  const [busy, setBusy]     = useState(false);
  const [error, setError]   = useState<string | null>(null);
  const [picker, setPicker] = useState<null | "amount" | "expiry">(null);

  const insufficient = amount > balance;
  const belowMin = balance > 0 && balance < RISK.MIN_TRADE;
  const profitPct = Math.round((payoutRatio - 1) * 100);
  const profit    = Math.round(amount * (payoutRatio - 1));
  const payout    = Math.round(amount * payoutRatio);

  async function place(direction: "UP" | "DOWN") {
    if (busy) return;
    if (amount < RISK.MIN_TRADE && !belowMin) { setError(`Minimum trade is ₵${RISK.MIN_TRADE}`); return; }
    if (insufficient) { setError("Insufficient balance"); return; }
    setError(null);
    setBusy(true);
    try {
      await api("/api/trades", {
        method: "POST",
        body: JSON.stringify({ asset, direction, amount: Number(amount), expirySeconds: expiry, isDemo }),
      });
      onPlaced();
    } catch (e: any) {
      setError(e.message);
      setTimeout(() => setError(null), 2500);
    } finally {
      setBusy(false);
    }
  }

  // Pickers and toasts float just above the trade bar using the same CSS var
  // the chart uses so they're always clear of the panel regardless of safe-area size.
  const aboveBar: React.CSSProperties = { bottom: "calc(var(--trade-bar-h) + 8px)" };

  return (
    <div className="md:hidden absolute left-0 right-0 bottom-0 z-20 pointer-events-none">
      {/* Picker popover */}
      <AnimatePresence>
      {picker && (
        <motion.div
          className="fixed inset-0 z-30 pointer-events-auto"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={() => setPicker(null)}
        >
          <motion.div
            className="absolute left-3 right-3 card p-3"
            style={aboveBar}
            initial={{ opacity: 0, y: 12, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.96 }}
            transition={{ type: "spring", stiffness: 360, damping: 28, mass: 0.7 }}
            onClick={(e) => e.stopPropagation()}
          >
            {picker === "amount" ? (
              <>
                <div className="text-xs text-muted mb-2">Trade amount (GHS)</div>
                {belowMin ? (
                  <div className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 rounded-md px-3 py-2 text-center mb-2">
                    Balance below ₵{RISK.MIN_TRADE} — trading full ₵{balance.toFixed(2)}
                  </div>
                ) : (
                  <>
                    <input
                      type="number"
                      className="input font-mono mb-2"
                      min={10} max={5000} step={1}
                      value={amount}
                      onChange={(e) => { const v = Number(e.target.value); if (!isNaN(v) && v >= 0) setAmount(v); }}
                    />
                    <div className="grid grid-cols-4 gap-1.5">
                      {QUICK_AMOUNTS.map((q) => (
                        <button key={q} onClick={() => { setAmount(q); setPicker(null); }}
                          className={`tab text-xs py-2 ${amount === q ? "tab-active" : "tab-idle bg-panel2"}`}>
                          ₵{q}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <div className="text-xs text-muted mb-2">Expiry</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {EXPIRIES.map((e) => (
                    <button key={e.s} onClick={() => { setExpiry(e.s); setPicker(null); }}
                      className={`tab text-xs py-2 text-center ${expiry === e.s ? "tab-active" : "tab-idle bg-panel2"}`}>
                      {e.label}
                    </button>
                  ))}
                </div>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Error toast */}
      <AnimatePresence>
      {error && (
        <motion.div
          className="absolute left-3 right-3 z-20 pointer-events-none"
          style={aboveBar}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 4 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <div className="bg-down/90 text-white text-xs rounded-md px-3 py-2 text-center">{error}</div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Panel — safe-area padding pushes content above the iOS home indicator */}
      <div
        className="pointer-events-auto bg-bg/97 backdrop-blur border-t border-border flex flex-col"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="px-3 pt-2 pb-2 flex flex-col gap-2">
          {/* Balance line */}
          <div className="flex items-center justify-between text-[10px] text-muted">
            <span>
              {isDemo ? "Demo" : "Real"} ·{" "}
              <span className={`font-mono ${insufficient ? "text-down" : "text-white/80"}`}>
                ₵{balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </span>
            {isDemo && insufficient && onDemoRefresh && (
              <button onClick={onDemoRefresh} className="text-accent font-semibold underline decoration-dotted">
                ↻ Refresh demo
              </button>
            )}
          </div>

          {/* Time | Amount */}
          <div className="grid grid-cols-2 gap-2">
            <div data-tour="expiry">
              <div className="text-[10px] text-muted mb-1">Time</div>
              <button
                onClick={() => setPicker(picker === "expiry" ? null : "expiry")}
                className="w-full flex items-center justify-between rounded-lg px-3 py-2 bg-panel2 border border-border text-sm font-mono hover:border-accent/40 transition-colors"
              >
                {EXPIRIES.find((e) => e.s === expiry)?.label ?? "--"}
                <span className="text-muted text-xs">⏱</span>
              </button>
            </div>
            <div data-tour="amount">
              <div className="text-[10px] text-muted mb-1">Amount</div>
              <button
                onClick={() => setPicker(picker === "amount" ? null : "amount")}
                className={`w-full flex items-center justify-between rounded-lg px-3 py-2 border text-sm font-mono transition-colors ${
                  insufficient
                    ? "border-down/40 bg-down/10 text-down"
                    : "bg-panel2 border-border hover:border-accent/40"
                }`}
              >
                ₵{amount}
                <span className="text-muted text-xs">⊙</span>
              </button>
            </div>
          </div>

          {/* Payout | +80% | Profit */}
          <div className="flex items-center justify-between px-1">
            <div>
              <div className="text-[10px] text-muted leading-none mb-0.5">Payout</div>
              <div className="font-mono text-xs text-white tabular-nums">₵{payout}</div>
            </div>
            <div className="text-2xl font-extrabold text-up tracking-tight">+{profitPct}%</div>
            <div className="text-right">
              <div className="text-[10px] text-muted leading-none mb-0.5">Profit</div>
              <div className="font-mono text-xs text-up tabular-nums">+₵{profit}</div>
            </div>
          </div>

          {/* BUY / SELL */}
          <div data-tour="trade-buttons" className="grid grid-cols-2 gap-2">
            <button
              onClick={() => place("UP")}
              disabled={busy}
              className="rounded-xl py-3 text-base font-bold text-black bg-up active:scale-95 transition-all disabled:opacity-50 touch-manipulation flex items-center justify-center gap-1.5"
            >
              <span className="text-lg leading-none">↗</span> BUY
            </button>
            <button
              onClick={() => place("DOWN")}
              disabled={busy}
              className="rounded-xl py-3 text-base font-bold text-white bg-down active:scale-95 transition-all disabled:opacity-50 touch-manipulation flex items-center justify-center gap-1.5"
            >
              <span className="text-lg leading-none">↘</span> SELL
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
