"use client";

import { memo, useEffect, useState } from "react";

type Trade = {
  id: string;
  asset: string;
  direction: "UP" | "DOWN";
  amount: number;
  entryPrice: number;
  expirySeconds: number;
  expiresAt: string;
  status: string;
  isDemo: boolean;
};

function OpenTradesImpl({ trades }: { trades: Trade[] }) {
  const [, setNow] = useState(Date.now());
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(i);
  }, []);

  if (!trades.length) {
    return <div className="text-muted text-sm text-center py-6">No open trades</div>;
  }

  return (
    <div className="space-y-2">
      {trades.map((t) => {
        const ms = new Date(t.expiresAt).getTime() - Date.now();
        const remaining = Math.max(0, Math.ceil(ms / 1000));
        const pct = Math.max(0, Math.min(100, (ms / (t.expirySeconds * 1000)) * 100));
        return (
          <div key={t.id} className="card p-3">
            <div className="flex justify-between items-center text-sm">
              <div className="flex items-center gap-2">
                <span className={`px-1.5 py-0.5 rounded text-xs font-semibold ${t.direction === "UP" ? "bg-up/20 text-up" : "bg-down/20 text-down"}`}>
                  {t.direction}
                </span>
                <span className="text-muted">{t.asset}</span>
              </div>
              <div className="font-mono">₵{t.amount.toFixed(2)}</div>
            </div>
            <div className="flex justify-between items-center text-xs text-muted mt-2">
              <span>Entry {t.entryPrice}</span>
              <span>{remaining}s left</span>
            </div>
            <div className="mt-2 h-1 bg-panel2 rounded-full overflow-hidden">
              <div className="h-full bg-accent transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

// Memoize on the `trades` array reference. Page passes the same reference
// between the 2s refreshTrades polls, so this short-circuits OpenTrades's
// re-renders during the 20Hz tick storm.
export default memo(OpenTradesImpl, (a, b) => a.trades === b.trades);
