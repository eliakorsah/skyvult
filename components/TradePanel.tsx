"use client";

import { useEffect, useState } from "react";
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
const QUICK = [10, 20, 50, 100, 500];

/** Pocket Option-style trade execution strip. Vertical layout:
 *    Time pills → Amount → HIGHER (green) → Payout % → LOWER (red)
 *  Keyboard shortcuts: W / ArrowUp = HIGHER, S / ArrowDown = LOWER.
 */
export default function TradePanel({
  asset,
  currentPrice,
  isDemo,
  balance,
  onPlaced,
  amount,
  setAmount,
  expiry,
  setExpiry,
  payoutRatio,
}: {
  asset: string;
  currentPrice: number | null;
  isDemo: boolean;
  balance: number;
  onPlaced: () => void;
  /** Controlled amount/expiry so the page-level state, the chart's TP/SL
   *  preview lines, the mobile bar, and this panel all stay in sync. */
  amount: number;
  setAmount: (v: number) => void;
  expiry: number;
  setExpiry: (v: number) => void;
  payoutRatio: number;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<"UP" | "DOWN" | null>(null);

  const insufficient = amount > balance;
  const belowMin = balance > 0 && balance < RISK.MIN_TRADE;
  const profitPct = Math.round((payoutRatio - 1) * 100);
  const win = Math.round(amount * payoutRatio);

  async function place(direction: "UP" | "DOWN") {
    if (busy) return;
    if (insufficient) { setError(`Insufficient ${isDemo ? "demo " : ""}balance`); return; }
    setError(null);
    setBusy(true);
    setFlash(direction);
    setTimeout(() => setFlash(null), 250);
    try {
      await api("/api/trades", {
        method: "POST",
        body: JSON.stringify({ asset, direction, amount: Number(amount), expirySeconds: expiry, isDemo }),
      });
      onPlaced();
    } catch (e: any) {
      setError(e.message);
      setTimeout(() => setError(null), 3000);
    } finally {
      setBusy(false);
    }
  }

  // Keyboard shortcuts — desktop power-user feature
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // Don't intercept while typing in inputs
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (e.key === "w" || e.key === "W" || e.key === "ArrowUp") { e.preventDefault(); place("UP"); }
      else if (e.key === "s" || e.key === "S" || e.key === "ArrowDown") { e.preventDefault(); place("DOWN"); }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, expiry, asset, isDemo, busy, currentPrice]);

  return (
    <div className="flex flex-col gap-3">
      {/* Expiry pills */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5">Time</div>
        <div className="grid grid-cols-6 gap-1">
          {EXPIRIES.map((e) => (
            <button
              key={e.s}
              onClick={() => setExpiry(e.s)}
              className={`tab text-xs text-center py-2 ${expiry === e.s ? "tab-active" : "tab-idle bg-panel2"}`}
            >
              {e.label}
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <div>
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1.5 flex justify-between">
          <span>Amount</span>
          <span className="text-muted normal-case tracking-normal">
            Balance ₵{balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
        </div>
        {belowMin ? (
          <div className="text-xs text-yellow-400 bg-yellow-400/10 border border-yellow-400/30 rounded-md px-3 py-2 text-center">
            Balance below ₵{RISK.MIN_TRADE} minimum — trading full ₵{balance.toFixed(2)}
          </div>
        ) : (
          <>
            <div className="flex items-stretch gap-1">
              <button
                onClick={() => setAmount(Math.max(10, amount - 10))}
                className="px-3 bg-panel2 border border-border rounded-md text-lg font-bold text-muted hover:text-white"
              >−</button>
              <input
                type="number"
                className="input font-mono text-center text-lg flex-1"
                min={10}
                max={5000}
                step={1}
                value={amount}
                onChange={(e) => setAmount(Number(e.target.value || 0))}
              />
              <button
                onClick={() => setAmount(Math.min(5000, amount + 10))}
                className="px-3 bg-panel2 border border-border rounded-md text-lg font-bold text-muted hover:text-white"
              >+</button>
            </div>
            <div className="grid grid-cols-5 gap-1 mt-1.5">
              {QUICK.map((q) => (
                <button
                  key={q}
                  onClick={() => setAmount(q)}
                  className={`tab text-[11px] py-1.5 ${amount === q ? "tab-active" : "tab-idle bg-panel2"}`}
                >
                  ₵{q}
                </button>
              ))}
            </div>
          </>
        )}
      </div>

      {error && (
        <div className="text-down text-xs bg-down/10 rounded-md px-3 py-2 border border-down/30">
          {error}
        </div>
      )}

      {/* HIGHER button (green) */}
      <button
        onClick={() => place("UP")}
        disabled={busy || insufficient}
        className={`btn btn-up py-5 text-base font-bold flex flex-col items-center justify-center gap-0.5 transition-transform disabled:opacity-50 ${
          flash === "UP" ? "scale-95" : ""
        }`}
        title="Higher  (W / ↑)"
      >
        <span className="flex items-center gap-2">
          <span className="text-xl leading-none">▲</span>
          <span>HIGHER</span>
        </span>
        <span className="text-[11px] opacity-80 font-mono">+ ₵{win.toLocaleString()}</span>
      </button>

      {/* Payout indicator (sandwiched between the buttons) */}
      <div className="flex items-center justify-between border-y border-border py-2 px-1">
        <span className="text-[10px] uppercase tracking-wider text-muted">Payout</span>
        <span className="text-accent font-bold text-sm">+{profitPct}%</span>
      </div>

      {/* LOWER button (red) */}
      <button
        onClick={() => place("DOWN")}
        disabled={busy || insufficient}
        className={`btn btn-down py-5 text-base font-bold flex flex-col items-center justify-center gap-0.5 transition-transform disabled:opacity-50 ${
          flash === "DOWN" ? "scale-95" : ""
        }`}
        title="Lower  (S / ↓)"
      >
        <span className="flex items-center gap-2">
          <span className="text-xl leading-none">▼</span>
          <span>LOWER</span>
        </span>
        <span className="text-[11px] opacity-80 font-mono">+ ₵{win.toLocaleString()}</span>
      </button>

      <div className="text-[10px] text-muted text-center pt-1">
        Keys: <span className="font-mono text-white">W</span>/<span className="font-mono text-white">↑</span> Higher · <span className="font-mono text-white">S</span>/<span className="font-mono text-white">↓</span> Lower
      </div>
    </div>
  );
}
