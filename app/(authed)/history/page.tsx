"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { fmtGhs } from "@/lib/assets";

type Trade = {
  id: string; asset: string; direction: "UP" | "DOWN"; amount: number;
  entryPrice: number; exitPrice: number | null;
  status: "OPEN" | "WON" | "LOST" | "DRAW"; payout: number; createdAt: string;
};

const FILTERS = ["All", "Won", "Lost", "Open"] as const;
type Filter = (typeof FILTERS)[number];

const STATUS_MAP: Record<Filter, string> = { All: "", Won: "WON", Lost: "LOST", Open: "OPEN" };
const STATUS_COLOR: Record<string, string> = { WON: "text-up", LOST: "text-down", OPEN: "text-accent", DRAW: "text-muted" };

export default function HistoryPage() {
  const [filter, setFilter] = useState<Filter>("All");
  const [trades, setTrades] = useState<Trade[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const s = STATUS_MAP[filter];
    api<{ trades: Trade[] }>(`/api/trades${s ? `?status=${s}&limit=100` : "?limit=100"}`)
      .then((d) => setTrades(d.trades))
      .finally(() => setLoading(false));
  }, [filter]);

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.status !== "OPEN");
    const wins = closed.filter((t) => t.status === "WON").length;
    const pnl = closed.reduce((s, t) => s + (t.payout - t.amount), 0);
    return { total: trades.length, winRate: closed.length ? Math.round((wins / closed.length) * 100) : 0, pnl };
  }, [trades]);

  return (
    <main className="min-h-screen flex flex-col">
      <div className="p-4 md:p-6 max-w-6xl w-full mx-auto flex-1">
        <h1 className="text-xl md:text-2xl font-bold">Trade history</h1>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3 mt-4">
          <div className="card p-3 md:p-4">
            <div className="text-xs text-muted uppercase">Trades</div>
            <div className="text-xl md:text-2xl font-bold mt-1">{stats.total}</div>
          </div>
          <div className="card p-3 md:p-4">
            <div className="text-xs text-muted uppercase">Win rate</div>
            <div className="text-xl md:text-2xl font-bold mt-1">{stats.winRate}%</div>
          </div>
          <div className="card p-3 md:p-4">
            <div className="text-xs text-muted uppercase">Net P&L</div>
            <div className={`text-xl md:text-2xl font-bold mt-1 ${stats.pnl >= 0 ? "text-up" : "text-down"}`}>
              {fmtGhs(stats.pnl)}
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="flex gap-1 mt-5 overflow-x-auto pb-1">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`tab whitespace-nowrap ${filter === f ? "tab-active" : "tab-idle"}`}>
              {f}
            </button>
          ))}
        </div>

        {/* Table — capped height, scrollable */}
        <div className="card mt-3 overflow-hidden max-h-[520px] flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm min-w-[560px]">
              <thead className="text-left text-xs text-muted uppercase border-b border-border sticky top-0 bg-panel z-10">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Asset</th>
                  <th className="px-3 py-2">Dir</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2 hidden sm:table-cell">Entry</th>
                  <th className="px-3 py-2 hidden sm:table-cell">Exit</th>
                  <th className="px-3 py-2">Result</th>
                  <th className="px-3 py-2">Payout</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted">Loading…</td></tr>
                ) : trades.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8 text-muted">No trades yet</td></tr>
                ) : trades.map((t) => (
                  <tr key={t.id} className="border-b border-border/40 hover:bg-panel2/40 transition-colors">
                    <td className="px-3 py-2 text-muted text-xs">{new Date(t.createdAt).toLocaleString()}</td>
                    <td className="px-3 py-2 font-medium">{t.asset}</td>
                    <td className={`px-3 py-2 font-bold ${t.direction === "UP" ? "text-up" : "text-down"}`}>{t.direction}</td>
                    <td className="px-3 py-2 font-mono">₵{t.amount.toFixed(2)}</td>
                    <td className="px-3 py-2 font-mono hidden sm:table-cell">{t.entryPrice}</td>
                    <td className="px-3 py-2 font-mono hidden sm:table-cell">{t.exitPrice ?? "—"}</td>
                    <td className={`px-3 py-2 font-semibold ${STATUS_COLOR[t.status] ?? ""}`}>{t.status}</td>
                    <td className="px-3 py-2 font-mono">₵{t.payout.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </main>
  );
}
