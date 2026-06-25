"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { DEPOSITS_ENABLED } from "@/lib/assets";

type Tx = {
  id: string; type: string; amount: number; balanceBefore: number;
  balanceAfter: number; reference: string | null; isDemo: boolean; createdAt: string;
};


const TX_COLOR: Record<string, string> = {
  DEPOSIT: "text-up",
  TRADE_CREDIT: "text-up",
  REFERRAL_BONUS: "text-up",
  WITHDRAWAL_REVERSAL: "text-up",
  WITHDRAWAL: "text-down",
  TRADE_DEBIT: "text-down",
};

// ─── Demo top-up card ──────────────────────────────────────────────────

const DEMO_PRESETS = [
  { amount: 10_000,  label: "₵10,000" },
  { amount: 50_000,  label: "₵50,000" },
  { amount: 100_000, label: "₵100,000" },
  { amount: 500_000, label: "₵500,000" },
];

function DemoTopupCard({ current, onResolved }: { current: number; onResolved: () => void }) {
  const [busy, setBusy]         = useState(false);
  const [msg, setMsg]           = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [selected, setSelected] = useState<number>(10_000);

  async function topUp() {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const r = await api<{ demoBalance: number }>("/api/wallet/demo-reset", {
        method: "POST",
        body: JSON.stringify({ amount: selected }),
      });
      setMsg({ type: "ok", text: `Demo balance set to ₵${r.demoBalance.toLocaleString()}` });
      onResolved();
    } catch (e: any) {
      setMsg({ type: "err", text: e?.message ?? "Top-up failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 md:p-6 mt-4 border border-accent/20 bg-accent/5">
      <div className="flex items-center justify-between mb-1">
        <div className="font-semibold">Demo Account Top-up</div>
        <span className="text-[10px] uppercase tracking-wider text-accent font-semibold">Practice</span>
      </div>
      <p className="text-muted text-xs mb-3">
        Set your demo balance to any amount below. No real money involved.
        Current: <span className="font-mono text-accent">₵{current.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
      </p>

      <div className="grid grid-cols-4 gap-2 mb-3">
        {DEMO_PRESETS.map((p) => (
          <button
            key={p.amount}
            onClick={() => setSelected(p.amount)}
            className={`tab text-xs py-2.5 font-mono font-semibold transition-all ${
              selected === p.amount ? "tab-active" : "tab-idle bg-panel2"
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {msg && (
        <div className={`text-xs rounded-md px-3 py-2 mb-3 ${
          msg.type === "ok"
            ? "bg-up/10 border border-up/30 text-up"
            : "bg-down/10 border border-down/30 text-down"
        }`}>
          {msg.text}
        </div>
      )}

      <button
        onClick={topUp}
        disabled={busy}
        className="w-full py-2.5 rounded-lg text-sm font-bold disabled:opacity-50 transition-opacity hover:opacity-90 active:scale-95"
        style={{ background: "#f7a600", color: "#000" }}
      >
        {busy ? "Setting balance…" : `Set demo to ₵${selected.toLocaleString()}`}
      </button>
    </div>
  );
}

export default function WalletPage() {
  const [balance, setBalance] = useState({ real: 0, demo: 0, locked: 0, wagering: 0 });
  const [txs, setTxs] = useState<Tx[]>([]);
  const [kycStatus, setKycStatus] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [w, t, k] = await Promise.all([
        api<{ balance: number; demoBalance: number; bonusLocked: number; wageringRemaining: number }>("/api/wallet"),
        api<{ transactions: Tx[] }>("/api/wallet/transactions?limit=50"),
        api<{ kycStatus: string }>("/api/kyc"),
      ]);
      setBalance({ real: w.balance, demo: w.demoBalance, locked: w.bonusLocked ?? 0, wagering: w.wageringRemaining ?? 0 });
      setTxs(t.transactions);
      setKycStatus(k.kycStatus);
    } catch { /* keep last good values */ }
  }, []);

  const withdrawable = Math.max(0, balance.real - balance.locked);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <main className="min-h-screen flex flex-col">
      <div className="p-4 md:p-6 max-w-5xl w-full mx-auto flex-1">
        <h1 className="text-xl md:text-2xl font-bold">Wallet</h1>

        {/* KYC banner */}
        {kycStatus === "NONE" && (
          <Link href="/kyc" className="mt-4 flex items-center justify-between gap-3 card p-4 border border-accent/30 bg-accent/5 hover:bg-accent/10 transition-colors">
            <div className="flex items-center gap-3">
              <span className="text-xl">🪪</span>
              <div>
                <p className="text-sm font-semibold text-accent">Verify your identity to unlock withdrawals</p>
                <p className="text-xs text-muted">Takes 2 minutes · Ghana Card, Passport, or Driver's License</p>
              </div>
            </div>
            <span className="text-accent text-sm font-bold flex-shrink-0">Verify →</span>
          </Link>
        )}
        {kycStatus === "PENDING" && (
          <Link href="/kyc" className="mt-4 flex items-center gap-3 card p-4 border border-accent/30 bg-accent/5">
            <span className="text-xl">⏳</span>
            <div>
              <p className="text-sm font-semibold text-accent">Verification under review</p>
              <p className="text-xs text-muted">We'll notify you once approved — usually within a few hours.</p>
            </div>
          </Link>
        )}
        {kycStatus === "REJECTED" && (
          <Link href="/kyc" className="mt-4 flex items-center justify-between gap-3 card p-4 border border-down/30 bg-down/5 hover:bg-down/10 transition-colors">
            <div className="flex items-center gap-3">
              <span className="text-xl">❌</span>
              <div>
                <p className="text-sm font-semibold text-down">Verification rejected — resubmit</p>
                <p className="text-xs text-muted">Tap to see the reason and resubmit your documents.</p>
              </div>
            </div>
            <span className="text-down text-sm font-bold flex-shrink-0">Fix →</span>
          </Link>
        )}

        {/* Balances */}
        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="card p-4 md:p-6">
            <div className="text-xs text-muted uppercase">Real balance</div>
            <div className="text-2xl md:text-3xl font-bold mt-2 font-mono">
              ₵{balance.real.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
            {balance.locked > 0 && (
              <div className="text-[11px] text-accent mt-1.5 font-medium">
                ₵{balance.locked.toLocaleString(undefined, { minimumFractionDigits: 2 })} locked ·
                ₵{withdrawable.toLocaleString(undefined, { minimumFractionDigits: 2 })} withdrawable
              </div>
            )}
          </div>
          <div className="card p-4 md:p-6">
            <div className="text-xs text-muted uppercase">Demo balance</div>
            <div className="text-2xl md:text-3xl font-bold mt-2 font-mono text-accent">
              ₵{balance.demo.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          </div>
        </div>

        {/* Referral bonus wagering banner */}
        {balance.locked > 0 && (
          <div className="mt-4 card p-4 border border-accent/30 bg-accent/5">
            <div className="flex items-center justify-between gap-2 mb-2">
              <p className="text-sm font-semibold text-accent">🎁 Referral bonus locked</p>
              <span className="text-[11px] font-mono text-muted">
                ₵{balance.wagering.toLocaleString(undefined, { minimumFractionDigits: 2 })} to go
              </span>
            </div>
            <p className="text-xs text-muted leading-relaxed">
              Your ₵{balance.locked.toLocaleString(undefined, { minimumFractionDigits: 2 })} referral bonus unlocks once
              you trade ₵{balance.wagering.toLocaleString(undefined, { minimumFractionDigits: 2 })} more in real money.
              Every real trade counts toward it.
            </p>
          </div>
        )}

        {/* Demo top-up */}
        <DemoTopupCard current={balance.demo} onResolved={refresh} />

        {/* Deposit + Withdraw side-by-side on desktop, stacked on mobile */}
        <div id="deposit" className="grid md:grid-cols-2 gap-3 mt-3">
          <DepositCard onResolved={refresh} />
          <WithdrawCard available={withdrawable} onResolved={refresh} />
        </div>

        {/* Transactions */}
        <h2 className="text-lg font-semibold mt-6 mb-2">Transactions</h2>
        <div className="card overflow-hidden max-h-[420px] flex flex-col">
          <div className="overflow-auto flex-1">
            <table className="w-full text-sm min-w-[440px]">
              <thead className="text-xs text-muted uppercase text-left border-b border-border sticky top-0 bg-panel z-10">
                <tr>
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Amount</th>
                  <th className="px-3 py-2 hidden sm:table-cell">Balance after</th>
                </tr>
              </thead>
              <tbody>
                {txs.length === 0
                  ? <tr><td colSpan={4} className="text-center text-muted py-8">No transactions</td></tr>
                  : txs.map((t) => (
                    <tr key={t.id} className="border-b border-border/40">
                      <td className="px-3 py-2 text-muted text-xs">{new Date(t.createdAt).toLocaleString()}</td>
                      <td className={`px-3 py-2 text-xs font-semibold ${TX_COLOR[t.type] ?? "text-muted"}`}>
                        {t.type.replace("_", " ")}{t.isDemo ? " (demo)" : ""}
                      </td>
                      <td className="px-3 py-2 font-mono">₵{t.amount.toFixed(2)}</td>
                      <td className="px-3 py-2 font-mono hidden sm:table-cell">₵{t.balanceAfter.toFixed(2)}</td>
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

// ─── Deposit card ──────────────────────────────────────────────────────

function DepositCard({ onResolved: _onResolved }: { onResolved: () => void }) {
  const [amount,       setAmount]       = useState(80);
  const [busy,         setBusy]         = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [copied,       setCopied]       = useState(false);
  const [instructions, setInstructions] = useState<{
    reference: string; amount: number;
    paymentLink?: string; depositInstructions?: string;
  } | null>(null);

  async function startDeposit() {
    if (busy) return;
    setError(null);
    if (amount < 80) { setError("Minimum deposit is ₵80."); return; }
    setBusy(true);
    try {
      const r = await api<{
        reference: string; amount: number;
        paymentLink?: string; depositInstructions?: string;
      }>(
        "/api/payments/deposit",
        { method: "POST", body: JSON.stringify({ amount }) }
      );
      setInstructions(r);
    } catch (e: any) {
      setError(e?.message ?? "Could not start deposit");
    } finally {
      setBusy(false);
    }
  }

  async function copyReference() {
    if (!instructions) return;
    const ref = instructions.reference;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(ref); setCopied(true); setTimeout(() => setCopied(false), 2500); return; } catch {}
    }
    const ta = document.createElement("textarea");
    ta.value = ref;
    ta.style.cssText = "position:fixed;left:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand("copy"); setCopied(true); setTimeout(() => setCopied(false), 2500); } catch {}
    document.body.removeChild(ta);
  }

  return (
    <div className="card p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Deposit</div>
        <span className="text-[10px] uppercase tracking-wider text-muted">Min ₵80</span>
      </div>
      <p className="text-muted text-xs mt-1">Add real cedis to your balance.</p>

      {!DEPOSITS_ENABLED ? (
        <div className="mt-3 text-xs bg-accent/10 border border-accent/30 rounded-md px-3 py-2 text-muted">
          Deposits are temporarily unavailable. Please check back soon.
        </div>
      ) : instructions ? (
        <div className="mt-4 space-y-3">
          {/* Amount */}
          <div className="bg-panel2 border border-border rounded-lg p-4">
            <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mb-0.5">Amount</p>
            <p className="text-lg font-bold font-mono text-up">₵{instructions.amount.toFixed(2)}</p>
          </div>

          {/* Reference — copy this and paste as the reference on the payment page */}
          <div className="bg-panel2 border border-accent/40 rounded-lg p-4">
            <p className="text-[10px] text-accent uppercase tracking-wider font-semibold mb-1">
              Step 1 · Copy your reference
            </p>
            <div className="flex items-center gap-2">
              <p className="font-mono font-bold text-accent text-lg tracking-widest flex-1 break-all">{instructions.reference}</p>
              <button
                onClick={copyReference}
                className="px-3 py-1.5 rounded-md text-xs font-semibold bg-accent/15 text-accent border border-accent/30 hover:bg-accent/25 transition-colors whitespace-nowrap"
              >
                {copied ? "Copied ✓" : "Copy"}
              </button>
            </div>
            <p className="text-[11px] text-muted mt-2">
              You <span className="text-white font-medium">must</span> paste this as the <span className="text-white font-medium">reference</span> on the payment page — it&apos;s how we match your payment to your account.
            </p>
          </div>

          {/* Proceed to pay — opens the payment page */}
          {instructions.paymentLink ? (
            <div>
              <p className="text-[10px] text-muted uppercase tracking-wider font-semibold mb-1">Step 2 · Pay</p>
              <a
                href={instructions.paymentLink}
                target="_blank"
                rel="noopener noreferrer"
                className="btn btn-up w-full py-3 flex items-center justify-center gap-2"
              >
                Proceed to pay →
              </a>
            </div>
          ) : (
            <div className="text-xs bg-accent/10 border border-accent/30 rounded-md px-3 py-2 text-muted">
              Payment is being set up. Please contact support and quote your reference above to complete your deposit.
            </div>
          )}

          <div className="text-xs bg-up/10 border border-up/30 rounded-md px-3 py-2 text-up">
            {instructions.depositInstructions ||
              "Your balance will be updated once we confirm your payment — usually within a few minutes."}
          </div>

          <button
            onClick={() => { setInstructions(null); setError(null); }}
            className="w-full py-2 text-xs text-muted hover:text-white transition-colors"
          >
            Make another deposit
          </button>
        </div>
      ) : (
        <>
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Amount (GHS)</div>
            <input
              type="number" min={80} max={50000} step={1}
              value={amount}
              onChange={(e) => setAmount(Number(e.target.value || 0))}
              className="input font-mono"
              disabled={busy}
            />
          </div>

          {error && (
            <div className="mt-3 text-down text-xs bg-down/10 border border-down/30 rounded-md px-3 py-2">{error}</div>
          )}

          <button
            onClick={startDeposit}
            disabled={busy}
            className="btn btn-up w-full mt-4 py-2.5 disabled:opacity-50"
          >
            {busy ? "Setting up…" : `Deposit ₵${amount.toLocaleString()}`}
          </button>
        </>
      )}
    </div>
  );
}

// ─── Withdraw card ─────────────────────────────────────────────────────

function WithdrawCard({ available, onResolved }: { available: number; onResolved: () => void }) {
  const [amount,   setAmount]   = useState(80);
  const [verified, setVerified] = useState<{ number: string; provider: string } | null | "loading">("loading");
  const [busy,     setBusy]     = useState(false);
  const [error,    setError]    = useState<string | null>(null);
  const [success,  setSuccess]  = useState<string | null>(null);

  useEffect(() => {
    api<{ kycStatus: string; verifiedMobileNumber?: string; verifiedMobileProvider?: string }>("/api/kyc/mobile")
      .then((d) => {
        if (d.verifiedMobileNumber) setVerified({ number: d.verifiedMobileNumber, provider: d.verifiedMobileProvider ?? "" });
        else setVerified(null);
      })
      .catch(() => setVerified(null));
  }, []);

  async function startWithdraw() {
    if (busy) return;
    setError(null); setSuccess(null);
    if (amount > available) { setError("Amount exceeds your real balance"); return; }
    setBusy(true);
    try {
      const r = await api<{ reference: string; message: string }>("/api/payments/withdraw", {
        method: "POST",
        body: JSON.stringify({ amount }),
      });
      setSuccess(r.message);
      setAmount(80);
      onResolved();
    } catch (e: any) {
      setError(e?.message ?? "Could not start withdrawal");
    } finally {
      setBusy(false);
    }
  }

  const insufficient = amount > available;

  return (
    <div className="card p-4 md:p-6">
      <div className="flex items-center justify-between">
        <div className="font-semibold">Withdraw to MoMo</div>
        <span className="text-[10px] uppercase tracking-wider text-muted">
          Avail ₵{available.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </span>
      </div>
      <p className="text-muted text-xs mt-1">Send real cedis to your verified Mobile Money number.</p>

      {/* Verified MoMo number display */}
      {verified === "loading" ? null : verified ? (
        <div className="mt-3 flex items-center gap-2 bg-panel2 border border-border rounded-lg px-3 py-2">
          <span className="text-up text-sm">✓</span>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-muted uppercase tracking-wider">Sending to</p>
            <p className="font-mono text-sm font-semibold truncate">{verified.number}</p>
          </div>
          <span className="text-[10px] text-muted bg-panel px-1.5 py-0.5 rounded">{verified.provider}</span>
        </div>
      ) : (
        <div className="mt-3 text-xs text-down bg-down/10 border border-down/30 rounded-lg px-3 py-2">
          No verified MoMo number. Complete KYC first.
        </div>
      )}

      <div className="mt-3">
        <div className="text-[10px] uppercase tracking-wider text-muted mb-1">Amount (GHS)</div>
        <input
          type="number" min={80} max={available} step={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value || 0))}
          className={`input font-mono ${insufficient ? "border-down/60 text-down" : ""}`}
        />
      </div>

      {error && <div className="mt-3 text-down text-xs bg-down/10 border border-down/30 rounded-md px-3 py-2">{error}</div>}
      {success && <div className="mt-3 text-up text-xs bg-up/10 border border-up/30 rounded-md px-3 py-2">{success}</div>}

      <button
        onClick={startWithdraw}
        disabled={busy || insufficient || !verified || verified === "loading"}
        className="btn btn-down w-full mt-4 py-2.5 disabled:opacity-50"
      >
        {busy ? "Sending…" : `Withdraw ₵${amount.toLocaleString()}`}
      </button>
    </div>
  );
}
