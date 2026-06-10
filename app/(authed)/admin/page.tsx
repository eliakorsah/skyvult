"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { fmtGhs } from "@/lib/assets";

function Lightbox({ url, label, onClose }: { url: string; label: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-black/90 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      {/* Header */}
      <div className="flex items-center justify-between w-full max-w-3xl mb-3" onClick={(e) => e.stopPropagation()}>
        <span className="text-sm font-semibold text-white">{label}</span>
        <button
          onClick={onClose}
          className="w-8 h-8 flex items-center justify-center rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors text-lg leading-none"
        >✕</button>
      </div>

      {/* Image */}
      <div className="w-full max-w-3xl flex-1 flex items-center justify-center min-h-0" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={label}
          className="max-w-full max-h-[75vh] rounded-xl object-contain shadow-2xl"
          onError={(e) => {
            // PDF fallback
            (e.target as HTMLImageElement).style.display = "none";
            (e.target as HTMLImageElement).nextElementSibling?.removeAttribute("style");
          }}
        />
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{ display: "none" }}
          className="flex flex-col items-center gap-3 text-accent"
        >
          <span className="text-5xl">📄</span>
          <span className="text-sm font-semibold">Open PDF in new tab</span>
        </a>
      </div>

      <p className="mt-3 text-xs text-white/40">Click anywhere outside or press Esc to close</p>
    </div>
  );
}

// ─── Adjust balance modal ────────────────────────────────────────────────

// ─── Types ───────────────────────────────────────────────────────────────

type Stats = {
  totalUsers: number; blockedUsers: number; activeTrades: number;
  userLiability: number; openExposure: number;
  volume24h: number; volume7d: number; volume30d: number;
  housePnl24h: number; housePnl7d: number; housePnl30d: number; housePnlAll: number;
  wageredAll: number; paidAll: number;
  effectiveEdge: number; configuredEdge: number;
  referredTotal: number; referredQualified: number; referralBonusPaid: number;
  daily: { day: string; pnl: number }[];
};

type AdminTrade = {
  id: string; asset: string; direction: "UP" | "DOWN"; amount: number;
  status: string; payout: number; isDemo: boolean; createdAt: string;
  user: { email: string; name: string } | null;
};

type AdminUser = {
  id: string; name: string; email: string; role: "USER" | "ADMIN";
  blocked: boolean; wallet: { balance: number; demoBalance: number } | null;
};

type AdminPayment = {
  id: string; userId: string;
  type: "DEPOSIT" | "WITHDRAWAL";
  amount: number;
  status: "PENDING" | "SUCCESS" | "FAILED" | "ABANDONED";
  mobileProvider: string | null; mobileNumber: string | null;
  failureReason: string | null; providerReference: string | null;
  createdAt: string; resolvedAt: string | null;
  user: { name: string; email: string } | null;
};

type PaymentSummary = {
  totalDeposits: number; totalWithdrawals: number;
  pendingCount: number; failedCount: number;
};

type KycSubmission = {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  fullName: string;
  dateOfBirth: string | null;
  idType: string;
  idNumber: string | null;
  mobileNumber: string | null;
  mobileProvider: string | null;
  rejectionReason: string | null;
  submittedAt: string;
  user: { id: string; name: string; email: string } | null;
  frontUrl: string | null;
  backUrl:  string | null;
  selfieUrl: string | null;
};

type SupportMessage = {
  id: string;
  userId: string;
  email: string | null;
  name: string | null;
  body: string;
  status: "OPEN" | "READ" | "RESOLVED";
  createdAt: string;
  resolvedAt: string | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────

const fmt = fmtGhs;

const ago = (iso: string) => {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)   return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
};

// ─── Sub-components ───────────────────────────────────────────────────────

function StatCard({
  label, value, sub, accent, mono,
}: { label: string; value: string; sub?: string; accent?: string; mono?: boolean }) {
  return (
    <div className={`card p-4 border-t-2 ${accent ?? "border-t-border"}`}>
      <p className="text-[11px] font-semibold text-muted uppercase tracking-widest">{label}</p>
      <p className={`text-xl font-bold mt-1.5 ${mono ? "font-mono tabular-nums" : "tracking-tight"}`}>
        {value}
      </p>
      {sub && <p className="text-[11px] text-muted mt-1 leading-snug">{sub}</p>}
    </div>
  );
}

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <div className="mt-8">
      <div className="flex items-center gap-3 mb-3">
        <h2 className="text-sm font-semibold text-white tracking-tight uppercase">{title}</h2>
        {count != null && (
          <span className="text-[10px] text-muted bg-panel2 border border-border rounded-full px-2 py-px">
            {count}
          </span>
        )}
        <div className="flex-1 h-px bg-border" />
      </div>
      {children}
    </div>
  );
}

const STATUS_PILL: Record<string, string> = {
  SUCCESS:   "bg-up/10 text-up border-up/25",
  ACTIVE:    "bg-up/10 text-up border-up/25",
  WIN:       "bg-up/10 text-up border-up/25",
  FAILED:    "bg-down/10 text-down border-down/25",
  LOSS:      "bg-down/10 text-down border-down/25",
  BLOCKED:   "bg-down/10 text-down border-down/25",
  PENDING:   "bg-accent/10 text-accent border-accent/25",
  OPEN:      "bg-accent/10 text-accent border-accent/25",
  READ:      "bg-muted/10 text-muted border-muted/25",
  RESOLVED:  "bg-up/10 text-up border-up/25",
  ABANDONED: "bg-muted/10 text-muted border-muted/25",
};

function Badge({ label }: { label: string }) {
  const cls = STATUS_PILL[label] ?? "bg-muted/10 text-muted border-muted/25";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-px text-[10px] font-semibold tracking-wide ${cls}`}>
      {label}
    </span>
  );
}

function DirBadge({ dir }: { dir: "UP" | "DOWN" }) {
  return (
    <span className={`inline-flex items-center gap-0.5 font-bold text-xs ${dir === "UP" ? "text-up" : "text-down"}`}>
      {dir === "UP" ? "▲" : "▼"} {dir}
    </span>
  );
}

function TypePill({ type }: { type: string }) {
  const cls = type === "DEPOSIT"
    ? "bg-up/10 text-up border-up/25"
    : "bg-accent/10 text-accent border-accent/25";
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-px text-[10px] font-semibold ${cls}`}>
      {type}
    </span>
  );
}

function PnlChart({ data }: { data: { day: string; pnl: number }[] }) {
  if (!data.length) return <p className="text-muted text-sm py-4">No closed trades yet.</p>;
  const max = Math.max(...data.map((d) => Math.abs(d.pnl)), 1);
  return (
    <div className="flex items-end gap-0.5 md:gap-1 h-28">
      {data.map((d, i) => {
        const h = Math.max(2, (Math.abs(d.pnl) / max) * 100);
        return (
          <div key={i} className="flex-1 flex flex-col items-center group relative">
            <div
              className={`w-full rounded-t transition-opacity group-hover:opacity-80 ${d.pnl >= 0 ? "bg-up/70" : "bg-down/70"}`}
              style={{ height: `${h}%` }}
            />
            <div className="absolute bottom-full mb-1 bg-panel2 border border-border rounded px-1.5 py-0.5 text-[10px] text-white whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-10">
              {new Date(d.day).toLocaleDateString()} · {fmt(d.pnl)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const PAYMENT_FILTERS = ["ALL", "DEPOSITS", "WITHDRAWALS", "PENDING", "FAILED"] as const;
type PaymentFilter = (typeof PAYMENT_FILTERS)[number];

function PaymentsSection({
  payments, summary, onAction,
}: {
  payments: AdminPayment[];
  summary: PaymentSummary | null;
  onAction: (id: string, action: "approve" | "reject") => Promise<void>;
}) {
  const [filter, setFilter] = useState<PaymentFilter>("PENDING");
  const [acting, setActing] = useState<string | null>(null);

  const filtered = payments.filter((p) => {
    if (filter === "DEPOSITS")    return p.type === "DEPOSIT";
    if (filter === "WITHDRAWALS") return p.type === "WITHDRAWAL";
    if (filter === "PENDING")     return p.status === "PENDING";
    if (filter === "FAILED")      return p.status === "FAILED";
    return true;
  });

  async function handleAction(id: string, action: "approve" | "reject") {
    if (action === "reject" && !confirm(`Reject this withdrawal and refund the user?`)) return;
    setActing(id);
    try { await onAction(id, action); } finally { setActing(null); }
  }

  return (
    <div>
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          <StatCard label="Total deposited"  value={fmt(summary.totalDeposits)}    accent="border-t-up"     mono />
          <StatCard label="Total withdrawn"  value={fmt(summary.totalWithdrawals)} accent="border-t-accent" mono />
          <StatCard
            label="Pending"
            value={String(summary.pendingCount)}
            accent={summary.pendingCount > 0 ? "border-t-accent" : "border-t-border"}
          />
          <StatCard
            label="Failed"
            value={String(summary.failedCount)}
            accent={summary.failedCount > 0 ? "border-t-down" : "border-t-border"}
          />
        </div>
      )}

      <div className="flex gap-1 mb-3 flex-wrap">
        {PAYMENT_FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
              filter === f
                ? "bg-accent text-black"
                : "bg-panel2 border border-border text-muted hover:text-white"
            }`}
          >
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden max-h-[480px] flex flex-col">
        <div className="overflow-auto flex-1">
          <table className="w-full text-sm min-w-[740px]">
            <thead className="sticky top-0 z-10 bg-panel">
              <tr className="text-left border-b border-border bg-panel2/50">
                <th className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">Time</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">User</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">Type</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">Amount</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">Network</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">Status</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider hidden md:table-cell">Reference</th>
                <th className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={8} className="text-center text-muted py-10 text-sm">No payments</td></tr>
              ) : filtered.map((p) => (
                <tr key={p.id} className="border-b border-border/40 hover:bg-panel2/30 transition-colors">
                  <td className="px-3 py-2.5 text-muted text-xs whitespace-nowrap">{ago(p.createdAt)}</td>
                  <td className="px-3 py-2.5">
                    <p className="text-xs font-medium truncate max-w-[140px]">{p.user?.email || "—"}</p>
                    {p.user?.name && <p className="text-[10px] text-muted">{p.user.name}</p>}
                    {p.mobileNumber && <p className="text-[10px] text-muted font-mono">{p.mobileNumber}</p>}
                  </td>
                  <td className="px-3 py-2.5"><TypePill type={p.type} /></td>
                  <td className="px-3 py-2.5 font-mono text-xs tabular-nums font-semibold">{fmt(p.amount)}</td>
                  <td className="px-3 py-2.5 text-xs text-muted">{p.mobileProvider ?? "—"}</td>
                  <td className="px-3 py-2.5">
                    <Badge label={p.status} />
                    {p.failureReason && (
                      <p className="text-[10px] text-muted mt-0.5 max-w-[160px] truncate" title={p.failureReason}>
                        {p.failureReason}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-2.5 hidden md:table-cell font-mono text-[10px] text-muted">
                    {p.providerReference?.slice(0, 20)}…
                  </td>
                  <td className="px-3 py-2.5">
                    {p.type === "WITHDRAWAL" && p.status === "PENDING" ? (
                      <div className="flex items-center gap-1.5">
                        <button
                          disabled={acting === p.id}
                          onClick={() => handleAction(p.id, "approve")}
                          className="px-2.5 py-1 text-[10px] font-semibold rounded bg-up/15 text-up border border-up/30 hover:bg-up/25 disabled:opacity-40 transition-colors whitespace-nowrap"
                        >
                          Approve
                        </button>
                        <button
                          disabled={acting === p.id}
                          onClick={() => handleAction(p.id, "reject")}
                          className="px-2.5 py-1 text-[10px] font-semibold rounded bg-down/15 text-down border border-down/30 hover:bg-down/25 disabled:opacity-40 transition-colors whitespace-nowrap"
                        >
                          Reject
                        </button>
                      </div>
                    ) : (
                      <span className="text-[10px] text-muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();
  const [stats,    setStats]    = useState<Stats | null>(null);
  const [trades,   setTrades]   = useState<AdminTrade[]>([]);
  const [users,    setUsers]    = useState<AdminUser[]>([]);
  const [payments, setPayments] = useState<AdminPayment[]>([]);
  const [paySum,   setPaySum]   = useState<PaymentSummary | null>(null);
  const [kyc,      setKyc]      = useState<KycSubmission[]>([]);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [error,    setError]    = useState<string | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(Date.now());
  const [lightbox, setLightbox] = useState<{ url: string; label: string } | null>(null);

  useEffect(() => {
    let alive = true;
    api<{ role?: string }>("/api/auth/me")
      .then((me) => { if (alive) { if (me.role === "ADMIN") setAuthorized(true); else router.replace("/trade"); } })
      .catch(() => alive && router.replace("/auth"));
    return () => { alive = false; };
  }, [router]);

  const refresh = useCallback(async () => {
    try {
      const [s, t, u, p, k, m] = await Promise.all([
        api<Stats>("/api/admin/stats"),
        api<{ trades: AdminTrade[] }>("/api/admin/trades?limit=20"),
        api<{ users: AdminUser[] }>("/api/admin/users"),
        api<{ payments: AdminPayment[]; summary: PaymentSummary }>("/api/admin/payments?limit=100"),
        api<{ submissions: KycSubmission[] }>("/api/admin/kyc?status=PENDING"),
        api<{ messages: SupportMessage[] }>("/api/admin/messages"),
      ]);
      setStats(s);
      setTrades(t.trades);
      setUsers(u.users);
      setPayments(p.payments);
      setPaySum(p.summary);
      setKyc(k.submissions);
      setMessages(m.messages);
      setLastRefresh(Date.now());
      setError(null);
    } catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => {
    if (!authorized) return;
    refresh();
    const i = setInterval(refresh, 10_000);
    return () => clearInterval(i);
  }, [refresh, authorized]);

  if (!authorized) return <main className="min-h-screen" />;

  async function toggleBlock(id: string, blocked: boolean) {
    await api(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify({ blocked: !blocked }) });
    refresh();
  }



  async function approveOrReject(id: string, action: "approve" | "reject") {
    await api(`/api/admin/payments/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
    refresh();
  }

  async function reviewKyc(id: string, action: "approve" | "reject") {
    const reason = action === "reject" ? prompt("Rejection reason (shown to user):") : undefined;
    if (action === "reject" && reason === null) return; // cancelled
    await api(`/api/admin/kyc/${id}`, { method: "PATCH", body: JSON.stringify({ action, reason: reason ?? undefined }) });
    refresh();
  }

  async function messageAction(id: string, action: "read" | "resolve" | "reopen") {
    await api(`/api/admin/messages/${id}`, { method: "PATCH", body: JSON.stringify({ action }) });
    refresh();
  }

  const pnlColor = (n: number) => n >= 0 ? "text-up" : "text-down";

  return (
    <main className="min-h-screen bg-bg">
      {lightbox  && <Lightbox url={lightbox.url} label={lightbox.label} onClose={() => setLightbox(null)} />}
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-6 md:py-8">

        {/* Page header */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <div className="flex items-center gap-2.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/SkyVult logo.png" alt="SkyVult" width={28} height={28} className="rounded-lg object-contain" />
              <h1 className="text-xl font-bold tracking-tight">SkyVult Admin</h1>
              <span className="text-[10px] font-semibold bg-panel2 border border-border text-muted px-2 py-0.5 rounded-full uppercase tracking-wider">Dashboard</span>
            </div>
            <p className="text-xs text-muted mt-1.5">
              Platform overview · refreshed {ago(new Date(lastRefresh).toISOString())}
            </p>
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="w-1.5 h-1.5 rounded-full bg-up animate-pulse" />
            <span className="text-xs text-muted font-medium">Live</span>
          </div>
        </div>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-down/10 border border-down/25 text-down text-sm">{error}</div>
        )}

        {!stats ? (
          <div className="text-muted text-sm animate-pulse">Loading platform data…</div>
        ) : (
          <>
            {/* ── House P&L hero ── */}
            <div className={`card p-5 md:p-6 mb-8 border-t-4 relative overflow-hidden ${stats.housePnlAll >= 0 ? "border-t-up" : "border-t-down"}`}>
              <div className={`absolute inset-0 bg-gradient-to-br ${stats.housePnlAll >= 0 ? "from-up/5" : "from-down/5"} to-transparent pointer-events-none`} />
              <p className="text-[11px] font-semibold text-muted uppercase tracking-widest mb-1">All-time House P&L</p>
              <p className={`text-4xl md:text-5xl font-bold font-mono tabular-nums tracking-tight mb-5 ${pnlColor(stats.housePnlAll)}`}>
                {fmt(stats.housePnlAll)}
              </p>
              <div className="grid grid-cols-3 gap-4 border-t border-border/60 pt-4">
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wider mb-0.5">24 h</p>
                  <p className={`text-base md:text-lg font-bold font-mono tabular-nums ${pnlColor(stats.housePnl24h)}`}>{fmt(stats.housePnl24h)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wider mb-0.5">7 d</p>
                  <p className={`text-base md:text-lg font-bold font-mono tabular-nums ${pnlColor(stats.housePnl7d)}`}>{fmt(stats.housePnl7d)}</p>
                </div>
                <div>
                  <p className="text-[10px] text-muted uppercase tracking-wider mb-0.5">30 d</p>
                  <p className={`text-base md:text-lg font-bold font-mono tabular-nums ${pnlColor(stats.housePnl30d)}`}>{fmt(stats.housePnl30d)}</p>
                </div>
              </div>
            </div>

            {/* ── Key metrics ── */}
            <Section title="Key metrics">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Total users"    value={String(stats.totalUsers)}    accent="border-t-accent" />
                <StatCard label="Active trades"  value={String(stats.activeTrades)}  accent="border-t-accent" />
                <StatCard label="24h volume"     value={fmt(stats.volume24h)}         accent="border-t-border" mono />
                <StatCard
                  label="24h house P&L"
                  value={fmt(stats.housePnl24h)}
                  accent={stats.housePnl24h >= 0 ? "border-t-up" : "border-t-down"}
                  mono
                />
              </div>
            </Section>

            {/* ── Financial health ── */}
            <Section title="Financial health" >
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard
                  label="User liability"
                  value={fmt(stats.userLiability)}
                  sub="Real balances owed"
                  accent="border-t-down"
                  mono
                />
                <StatCard
                  label="Open exposure"
                  value={fmt(stats.openExposure)}
                  sub="Worst-case payout"
                  accent="border-t-down"
                  mono
                />
                <StatCard label="Blocked users"  value={String(stats.blockedUsers)} />
                <StatCard
                  label="Effective edge"
                  value={(stats.effectiveEdge * 100).toFixed(2) + "%"}
                  sub={`Target ${(stats.configuredEdge * 100).toFixed(0)}%`}
                  accent={stats.effectiveEdge >= stats.configuredEdge * 0.8 ? "border-t-up" : "border-t-down"}
                />
              </div>
            </Section>

            {/* ── Volume & P&L ── */}
            <Section title="Volume & P&L">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="7d volume"  value={fmt(stats.volume7d)}   mono />
                <StatCard label="30d volume" value={fmt(stats.volume30d)}  mono />
                <StatCard label="7d P&L"  value={fmt(stats.housePnl7d)}  accent={stats.housePnl7d  >= 0 ? "border-t-up" : "border-t-down"} mono />
                <StatCard label="30d P&L" value={fmt(stats.housePnl30d)} accent={stats.housePnl30d >= 0 ? "border-t-up" : "border-t-down"} mono />
              </div>
            </Section>

            {/* ── Lifetime + Referrals ── */}
            <Section title="Lifetime & referrals">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <StatCard label="Wagered (all)" value={fmt(stats.wageredAll)} mono />
                <StatCard label="Paid out (all)" value={fmt(stats.paidAll)}  mono />
                <StatCard
                  label="House P&L (all)"
                  value={fmt(stats.housePnlAll)}
                  accent={stats.housePnlAll >= 0 ? "border-t-up" : "border-t-down"}
                  mono
                />
                <StatCard
                  label="Referral signups"
                  value={String(stats.referredTotal)}
                  sub={`${stats.referredQualified} deposited`}
                />
                <StatCard
                  label="Bonus paid"
                  value={fmt(stats.referralBonusPaid)}
                  sub="Real-money credits"
                  mono
                />
                <StatCard
                  label="Eff. CAC"
                  value={stats.referredQualified > 0 ? fmt(stats.referralBonusPaid / stats.referredQualified) : "—"}
                  sub="Bonus ÷ qualified"
                  mono
                />
              </div>
            </Section>

            {/* ── Daily P&L chart ── */}
            <Section title="Daily P&L — last 14 days">
              <div className="card p-4">
                <PnlChart data={stats.daily} />
              </div>
            </Section>
          </>
        )}

        {/* ── KYC ── */}
        <Section title="KYC Verification" count={kyc.length}>
          {kyc.length === 0 ? (
            <p className="text-muted text-sm py-4">No pending KYC submissions.</p>
          ) : (
            <div className="flex flex-col gap-4 max-h-[600px] overflow-y-auto pr-1">
              {kyc.map((k) => (
                <div key={k.id} className="card p-5 flex flex-col gap-4 border border-border">

                  {/* User info + actions */}
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="space-y-0.5">
                      <p className="font-bold text-base">{k.fullName}</p>
                      <p className="text-xs text-muted">{k.user?.email ?? "—"} · {k.user?.name ?? "—"}</p>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                        <span className="text-xs">
                          <span className="text-muted">MoMo: </span>
                          <span className="font-mono font-semibold">{k.mobileNumber ?? "—"}</span>
                          {k.mobileProvider && <span className="text-muted"> ({k.mobileProvider})</span>}
                        </span>
                        {k.idNumber && (
                          <span className="text-xs">
                            <span className="text-muted">ID No: </span>
                            <span className="font-mono font-semibold">{k.idNumber}</span>
                          </span>
                        )}
                        <span className="text-xs text-muted">{ago(k.submittedAt)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => reviewKyc(k.id, "approve")}
                        className="px-4 py-2 text-sm font-semibold rounded-lg bg-up/15 text-up border border-up/30 hover:bg-up/25 transition-colors"
                      >✓ Approve</button>
                      <button
                        onClick={() => reviewKyc(k.id, "reject")}
                        className="px-4 py-2 text-sm font-semibold rounded-lg bg-down/15 text-down border border-down/30 hover:bg-down/25 transition-colors"
                      >✗ Reject</button>
                    </div>
                  </div>

                  {/* Document images — click opens lightbox */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    {[
                      { url: k.frontUrl,  label: "Front of ID" },
                      { url: k.backUrl,   label: "Back of ID"  },
                      { url: k.selfieUrl, label: "Selfie"      },
                    ].map(({ url, label }) => (
                      <div key={label} className="flex flex-col gap-1.5">
                        <p className="text-[10px] text-muted uppercase tracking-wider font-semibold">{label}</p>
                        {url ? (
                          <button
                            type="button"
                            onClick={() => setLightbox({ url, label })}
                            className="block group text-left w-full rounded-lg overflow-hidden border border-border hover:border-accent/60 transition-colors focus:outline-none focus:ring-2 focus:ring-accent/50"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={url}
                              alt={label}
                              className="w-full h-40 object-cover bg-panel2 group-hover:scale-[1.02] transition-transform duration-200"
                              onError={(e) => {
                                (e.target as HTMLImageElement).style.display = "none";
                                (e.target as HTMLImageElement).nextElementSibling?.removeAttribute("style");
                              }}
                            />
                            <div
                              style={{ display: "none" }}
                              className="w-full h-40 bg-panel2 flex flex-col items-center justify-center gap-2 text-accent text-xs font-semibold"
                            >
                              <span className="text-3xl">📄</span>
                              Tap to view PDF
                            </div>
                          </button>
                        ) : (
                          <div className="w-full h-40 rounded-lg border border-border bg-panel2 flex items-center justify-center text-muted text-xs">
                            Not provided
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Messages ── */}
        <Section title="Messages" count={messages.filter((m) => m.status !== "RESOLVED").length}>
          {messages.length === 0 ? (
            <p className="text-muted text-sm py-4">No messages.</p>
          ) : (
            <div className="flex flex-col gap-3 max-h-[500px] overflow-y-auto pr-1">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`card p-4 border ${m.status === "OPEN" ? "border-accent/40 bg-accent/[0.03]" : "border-border"}`}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{m.name ?? "Unknown"}</span>
                        <Badge label={m.status} />
                        <span className="text-[11px] text-muted">{ago(m.createdAt)}</span>
                      </div>
                      <p className="text-xs text-muted">{m.email ?? "—"}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {m.status === "OPEN" && (
                        <button
                          onClick={() => messageAction(m.id, "read")}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-panel2 border border-border text-muted hover:text-white transition-colors"
                        >Mark read</button>
                      )}
                      {m.status !== "RESOLVED" ? (
                        <button
                          onClick={() => messageAction(m.id, "resolve")}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-up/15 text-up border border-up/30 hover:bg-up/25 transition-colors"
                        >✓ Resolve</button>
                      ) : (
                        <button
                          onClick={() => messageAction(m.id, "reopen")}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-panel2 border border-border text-muted hover:text-white transition-colors"
                        >Reopen</button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm mt-2.5 whitespace-pre-wrap break-words">{m.body}</p>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Payments ── */}
        <Section title="Payments" count={payments.length}>
          <PaymentsSection payments={payments} summary={paySum} onAction={approveOrReject} />
        </Section>

        {/* ── Live trades ── */}
        <Section title="Live trades" count={trades.length}>
          <div className="card overflow-hidden max-h-[400px] flex flex-col">
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm min-w-[560px]">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="text-left border-b border-border bg-panel2/50">
                    {["Time", "User", "Asset", "Dir", "Amount", "Status", "Payout"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {trades.length === 0 ? (
                    <tr><td colSpan={7} className="text-center text-muted py-10 text-sm">No trades yet</td></tr>
                  ) : trades.map((t) => (
                    <tr key={t.id} className="border-b border-border/40 hover:bg-panel2/30 transition-colors">
                      <td className="px-3 py-2.5 text-muted text-xs whitespace-nowrap">{ago(t.createdAt)}</td>
                      <td className="px-3 py-2.5 text-xs truncate max-w-[140px]">{t.user?.email ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs font-medium">{t.asset}</td>
                      <td className="px-3 py-2.5"><DirBadge dir={t.direction} /></td>
                      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">
                        {fmt(t.amount)}{t.isDemo ? <span className="text-muted ml-1 text-[10px]">demo</span> : ""}
                      </td>
                      <td className="px-3 py-2.5"><Badge label={t.status} /></td>
                      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">{fmt(t.payout)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* ── Users ── */}
        <Section title="Users" count={users.length}>
          <div className="card overflow-hidden max-h-[480px] flex flex-col">
            <div className="overflow-auto flex-1">
              <table className="w-full text-sm min-w-[580px]">
                <thead className="sticky top-0 z-10 bg-panel">
                  <tr className="text-left border-b border-border bg-panel2/50">
                    {["Email / Name", "Role", "Real ₵", "Demo ₵", "Status", "Actions"].map((h) => (
                      <th key={h} className="px-3 py-2.5 text-[10px] font-semibold text-muted uppercase tracking-wider">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.length === 0 ? (
                    <tr><td colSpan={6} className="text-center text-muted py-10 text-sm">No users yet</td></tr>
                  ) : users.map((u) => (
                    <tr key={u.id} className="border-b border-border/40 hover:bg-panel2/30 transition-colors">
                      <td className="px-3 py-2.5">
                        <p className="text-xs font-medium truncate max-w-[180px]">{u.email}</p>
                        <p className="text-[10px] text-muted">{u.name}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className={`text-[10px] font-semibold ${u.role === "ADMIN" ? "text-accent" : "text-muted"}`}>
                          {u.role}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs tabular-nums">{u.wallet ? fmt(u.wallet.balance) : "—"}</td>
                      <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-muted">{u.wallet ? fmt(u.wallet.demoBalance) : "—"}</td>
                      <td className="px-3 py-2.5">
                        <Badge label={u.blocked ? "BLOCKED" : "ACTIVE"} />
                      </td>
                      <td className="px-3 py-2.5 space-x-3 whitespace-nowrap">
                        <button
                          onClick={() => toggleBlock(u.id, u.blocked)}
                          className={`text-xs font-medium underline underline-offset-2 ${u.blocked ? "text-up hover:text-up/80" : "text-down hover:text-down/80"}`}
                        >
                          {u.blocked ? "Unblock" : "Block"}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </Section>

        {/* Footer */}
        <div className="mt-12 pb-6 flex items-center justify-between text-[11px] text-muted border-t border-border pt-4">
          <span>SkyVult Platform · Admin</span>
          <span className="font-mono tabular-nums">
            {new Date().toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "short", day: "numeric" })}
          </span>
        </div>

      </div>
    </main>
  );
}
