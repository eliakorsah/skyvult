"use client";

import Link from "next/link";
import { useRouter, usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api, clearTokens } from "@/lib/api";
import { ASSET_CONFIGS, fmtGhsFull } from "@/lib/assets";
import { AnimatePresence, motion } from "framer-motion";

type Me = {
  id: string; name: string; email: string; role: "USER" | "ADMIN";
  referralCode: string | null;
  wallet: { balance: number; demoBalance: number; isDemo: boolean } | null;
};

type ReferralStats = {
  code: string | null;
  referredCount: number;
  paidCount: number;
  totalBonus: number;
};

const NAV_ICONS: Record<string, string> = {
  "/trade":   "📈",
  "/history": "🕐",
  "/wallet":  "💳",
  "/kyc":     "🪪",
  "/support": "💬",
  "/admin":   "⚙️",
};

export default function Nav({
  current, currentPrice, isDemo, onToggleDemo, liveBalance, onShowReferral,
}: {
  current?: string;
  currentPrice?: number;
  isDemo?: boolean;
  onToggleDemo?: (v: boolean) => void;
  liveBalance?: number;
  onShowReferral?: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [me, setMe] = useState<Me | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [resetMsg, setResetMsg] = useState<string | null>(null);
  const [referral, setReferral] = useState<ReferralStats | null>(null);
  const [copied, setCopied] = useState(false);

  // Load referral stats once when the avatar menu first opens. Keeps the
  // network cost off the initial Nav render — most users never open the menu.
  useEffect(() => {
    if (!menuOpen || referral) return;
    let alive = true;
    api<ReferralStats>("/api/referral")
      .then((r) => alive && setReferral(r))
      .catch(() => { /* silent — menu still works without it */ });
    return () => { alive = false; };
  }, [menuOpen, referral]);

  async function copyReferral() {
    const code = referral?.code ?? me?.referralCode;
    if (!code) return;
    const shareUrl = `${window.location.origin}/auth?mode=register&ref=${encodeURIComponent(code)}`;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — user can still long-press to copy */ }
  }

  async function refreshDemo() {
    if (resetting) return;
    setResetting(true);
    setResetMsg(null);
    try {
      const r = await api<{ demoBalance: number }>("/api/wallet/demo-reset", { method: "POST" });
      setMe((m) => m ? { ...m, wallet: m.wallet ? { ...m.wallet, demoBalance: r.demoBalance } : null } : m);
      setResetMsg(`Demo reset to ₵${r.demoBalance.toLocaleString()}`);
      setTimeout(() => setResetMsg(null), 2000);
    } catch (e: any) {
      setResetMsg(e?.message || "Reset failed");
      setTimeout(() => setResetMsg(null), 3000);
    } finally {
      setResetting(false);
    }
  }

  useEffect(() => {
    let alive = true;
    // Only bounce to /auth if we have no token at all. Don't bounce on transient
    // network/server errors — that creates a redirect loop after fresh login.
    if (typeof window !== "undefined" && !localStorage.getItem("skyvult_access")) {
      router.push("/auth");
      return;
    }
    api<Me>("/api/auth/me")
      .then((m) => alive && setMe(m))
      .catch((err) => {
        if (!alive) return;
        const msg = String(err?.message || "").toLowerCase();
        // Only bounce on explicit auth failure
        if (msg.includes("unauthorized") || msg.includes("invalid")) {
          clearTokens();
          router.push("/auth");
        }
        // otherwise: keep the user on the page; they can retry/refresh
      });
    return () => { alive = false; };
  }, [router]);

  // Poll the wallet every 2s so the balance stays live on EVERY route — not
  // just /trade. Without this, the header balance shows the value cached when
  // Nav mounted (potentially minutes/hours stale on long-lived sessions),
  // which is why the same account can display different numbers on different
  // devices: each device shows its own snapshot rather than current truth.
  useEffect(() => {
    let alive = true;
    if (typeof window !== "undefined" && !localStorage.getItem("skyvult_access")) return;
    const poll = async () => {
      // Skip when tab hidden or when on /trade (trade page pushes live balance via SessionContext).
      if (document.visibilityState === "hidden") return;
      if (window.location.pathname.startsWith("/trade")) return;
      try {
        const w = await api<{ balance: number; demoBalance: number }>("/api/wallet");
        if (!alive) return;
        setMe((m) => m ? { ...m, wallet: { balance: w.balance, demoBalance: w.demoBalance, isDemo: m.wallet?.isDemo ?? false } } : m);
      } catch { /* silent — keep last good value */ }
    };
    poll();
    // Poll every 3s on non-trade pages (less aggressive than trade page's 2s).
    const i = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(i); };
  }, []);

  // Close mobile nav on route change
  useEffect(() => setMobileNavOpen(false), [pathname]);

  function logout() { clearTokens(); router.push("/auth"); }

  // Prefer the live balance passed from the parent page (polled every 2s
   // and updated immediately after trade results) over the value cached on
   // mount via /api/auth/me. Falls back to the cached value if no live
   // balance is available yet (e.g. on routes that don't poll the wallet).
  const balance = liveBalance ?? (isDemo ? me?.wallet?.demoBalance ?? 0 : me?.wallet?.balance ?? 0);

  const navLinks = [
    { href: "/trade",   label: "Trade" },
    { href: "/history", label: "History" },
    { href: "/wallet",  label: "Wallet" },
    { href: "/kyc",     label: "Verify" },
    { href: "/support", label: "Message Us" },
    ...(me?.role === "ADMIN" ? [{ href: "/admin", label: "Admin" }] : []),
  ];

  return (
    <>
      <header className="flex items-center justify-between px-4 py-3 border-b border-border bg-panel relative z-30">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <Link href="/trade" className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/SkyVult logo.png" alt="SkyVult" width={28} height={28} className="rounded-lg object-contain" />
            <span className="font-bold hidden sm:inline">SkyVult</span>
          </Link>

          {/* Desktop asset price */}
          {current && (
            <div className="hidden md:flex items-center gap-2 ml-2 pl-3 border-l border-border">
              <span className="text-muted text-xs">{current}</span>
              <span className="font-mono text-accent text-sm">{currentPrice?.toFixed(getPrec(current)) ?? "--"}</span>
            </div>
          )}
        </div>

        {/* Desktop nav links */}
        <nav className="hidden md:flex items-center gap-1">
          {navLinks.map((l) => (
            <Link key={l.href} href={l.href}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${pathname === l.href ? "bg-panel2 text-white" : "text-muted hover:text-white"}`}>
              {l.label}
            </Link>
          ))}
        </nav>

        {/* Right side */}
        <div className="flex items-center gap-2">
          {/* Referral shortcut — copies share link; earns the user ₵10 when
              a referee makes their first qualifying deposit. */}
          {me?.referralCode && (
            <button
              onClick={() => onShowReferral?.()}
              title="Share your referral link and earn ₵10"
              className="flex items-center gap-1 text-xs px-2.5 py-1 rounded-md font-semibold border border-up/40 text-up bg-up/10 hover:bg-up/20 transition-colors"
            >
              Free ₵10
            </button>
          )}

          {/* Demo/Real toggle — DEMO is visually filled so the user always
              knows they're not trading real money. */}
          {onToggleDemo && (
            <button onClick={() => onToggleDemo(!isDemo)}
              title={`Switch to ${isDemo ? "REAL" : "DEMO"} mode`}
              className={`text-xs px-2.5 py-1 rounded-md font-semibold border ${
                isDemo
                  ? "bg-accent/15 border-accent text-accent"
                  : "border-border text-muted hover:text-white"
              }`}>
              {isDemo ? "DEMO" : "REAL"}
            </button>
          )}

          {/* Balance — always visible, bold, prominent. Critical info for traders.
              Shown in full (never abbreviated) with responsive sizing so large
              values scale down on small screens instead of overflowing. */}
          <div className="text-right min-w-0">
            <div className="text-[10px] uppercase tracking-wider text-muted leading-none">
              {isDemo ? "Demo" : "Real"}
            </div>
            <div className="font-mono font-bold leading-tight tabular-nums whitespace-nowrap text-sm sm:text-base">
              {fmtGhsFull(balance)}
            </div>
          </div>

          {/* Deposit shortcut — visible on desktop only */}
          <Link
            href="/wallet#deposit"
            className="hidden sm:flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg font-semibold bg-accent text-black hover:bg-accent/90 transition-colors"
          >
            + Deposit
          </Link>

          {/* User avatar */}
          <div className="relative">
            <button onClick={() => setMenuOpen((v) => !v)}
              className="w-8 h-8 grid place-items-center rounded-full bg-panel2 border border-border text-sm font-semibold">
              {me?.name?.[0]?.toUpperCase() ?? "?"}
            </button>
            <AnimatePresence>
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                  onTouchStart={() => setMenuOpen(false)}
                />
                <motion.div
                  className="absolute right-0 mt-2 w-56 card p-2 z-50 shadow-xl"
                  initial={{ opacity: 0, scale: 0.94, y: -8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.94, y: -8 }}
                  transition={{ type: "spring", stiffness: 380, damping: 28, mass: 0.7 }}
                  style={{ transformOrigin: "top right" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="px-2 py-1 text-sm font-medium">{me?.name}</div>
                  <div className="px-2 pb-2 text-xs text-muted">{me?.email}</div>

                  {/* Referral panel — code + share link + per-user stats.
                      Bonus credits when a referee makes a deposit ≥ ₵80. */}
                  <div className="px-2 py-2 border-t border-border mt-1">
                    <div className="text-[10px] uppercase tracking-wider text-muted">Refer & earn ₵10</div>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="font-mono text-sm text-accent truncate flex-1">
                        {referral?.code ?? me?.referralCode ?? "—"}
                      </span>
                      <button
                        onClick={copyReferral}
                        disabled={!(referral?.code || me?.referralCode)}
                        className="text-[10px] px-2 py-1 rounded bg-panel2 border border-border text-white hover:bg-accent hover:text-black disabled:opacity-40"
                      >
                        {copied ? "Copied" : "Copy link"}
                      </button>
                    </div>
                    {referral && (
                      <div className="mt-1.5 text-[10px] text-muted flex items-center justify-between">
                        <span>{referral.referredCount} signups · {referral.paidCount} qualified</span>
                        <span className="text-up font-mono">
                          ₵{referral.totalBonus.toLocaleString()}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Refresh demo balance — only shown when in demo mode */}
                  {isDemo && (
                    <button
                      onClick={refreshDemo}
                      disabled={resetting}
                      className="w-full text-left px-2 py-2 hover:bg-panel2 rounded-md text-accent text-sm border-t border-border mt-1 disabled:opacity-50"
                    >
                      {resetting ? "Resetting…" : "↻ Refresh demo balance"}
                    </button>
                  )}
                  {resetMsg && (
                    <div className="px-2 py-1 text-[11px] text-muted">{resetMsg}</div>
                  )}
                  <button onClick={() => { setMenuOpen(false); logout(); }} className="w-full text-left px-2 py-2 hover:bg-panel2 rounded-md text-down text-sm border-t border-border mt-1">
                    Log out
                  </button>
                </motion.div>
              </>
            )}
            </AnimatePresence>
          </div>

          {/* Mobile hamburger */}
          <button className="md:hidden p-1" onClick={() => setMobileNavOpen((v) => !v)}>
            <div className="w-5 space-y-1">
              <span className={`block h-0.5 bg-white transition-transform ${mobileNavOpen ? "rotate-45 translate-y-1.5" : ""}`} />
              <span className={`block h-0.5 bg-white transition-opacity ${mobileNavOpen ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 bg-white transition-transform ${mobileNavOpen ? "-rotate-45 -translate-y-1.5" : ""}`} />
            </div>
          </button>
        </div>
      </header>

      {/* ── Mobile right-side drawer ── */}
      {/* Backdrop */}
      <div
        className={`md:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${
          mobileNavOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setMobileNavOpen(false)}
      />

      {/* Drawer panel */}
      <div
        className={`md:hidden fixed top-0 right-0 h-full w-[300px] z-50 flex flex-col
          bg-[#0d1017] border-l border-white/10
          transition-transform duration-300 ease-in-out
          ${mobileNavOpen ? "translate-x-0" : "translate-x-full"}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Subtle accent glow on the left edge */}
        <div className="absolute left-0 top-0 bottom-0 w-px bg-gradient-to-b from-transparent via-accent/40 to-transparent pointer-events-none" />

        {/* Header: close + logo */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-white/8">
          <div className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/SkyVult logo.png" alt="SkyVult" width={26} height={26} className="rounded-lg object-contain" />
            <span className="font-bold text-sm tracking-tight">SkyVult</span>
          </div>
          <button
            onClick={() => setMobileNavOpen(false)}
            className="w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 text-muted hover:text-white transition-colors text-sm"
          >✕</button>
        </div>

        {/* User info + balance */}
        {me && (
          <div className="px-5 py-4 border-b border-white/8">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent/30 to-accent/10 border border-accent/30 flex items-center justify-center text-sm font-bold text-accent flex-shrink-0">
                {me.name?.[0]?.toUpperCase() ?? "?"}
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold truncate">{me.name}</p>
                <p className="text-[11px] text-muted truncate">{me.email}</p>
              </div>
            </div>
            {/* Balances */}
            <div className="grid grid-cols-2 gap-2">
              <div className={`rounded-xl px-3 py-2.5 border ${isDemo ? "border-border bg-panel2/50" : "border-accent/30 bg-accent/8"}`}>
                <p className="text-[10px] text-muted uppercase tracking-wider mb-0.5">Real</p>
                <p className="font-mono text-xs sm:text-sm font-bold tabular-nums truncate">
                  {fmtGhsFull(me.wallet?.balance ?? 0)}
                </p>
              </div>
              <div className={`rounded-xl px-3 py-2.5 border ${isDemo ? "border-accent/30 bg-accent/8" : "border-border bg-panel2/50"}`}>
                <p className="text-[10px] text-muted uppercase tracking-wider mb-0.5">Demo</p>
                <p className="font-mono text-xs sm:text-sm font-bold tabular-nums truncate text-accent">
                  {fmtGhsFull(me.wallet?.demoBalance ?? 0)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Navigation links */}
        <nav className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-0.5">
          {navLinks.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                onClick={() => setMobileNavOpen(false)}
                className={`flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium transition-all ${
                  active
                    ? "bg-accent/15 text-accent border border-accent/20"
                    : "text-muted hover:text-white hover:bg-white/5"
                }`}
              >
                <span className="w-5 text-center text-base leading-none">{NAV_ICONS[l.href] ?? "›"}</span>
                {l.label}
                {active && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-accent" />}
              </Link>
            );
          })}
        </nav>

        {/* Footer actions */}
        <div className="px-3 pb-6 pt-2 border-t border-white/8 flex flex-col gap-1">
          {/* Demo/Real toggle */}
          {onToggleDemo && (
            <button
              onClick={() => { onToggleDemo(!isDemo); setMobileNavOpen(false); }}
              className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-muted hover:text-white hover:bg-white/5 transition-all w-full text-left"
            >
              <span className="w-5 text-center text-base leading-none">⇄</span>
              Switch to {isDemo ? "Real" : "Demo"}
              <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 rounded-full ${isDemo ? "bg-accent/20 text-accent" : "bg-white/10 text-muted"}`}>
                {isDemo ? "DEMO" : "REAL"}
              </span>
            </button>
          )}

          {/* Deposit — primary CTA in mobile drawer */}
          <Link
            href="/wallet#deposit"
            onClick={() => setMobileNavOpen(false)}
            className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-semibold bg-accent text-black hover:bg-accent/90 transition-colors w-full"
          >
            <span className="w-5 text-center text-base leading-none">💰</span>
            Deposit
          </Link>

          {/* Referral */}
          {me?.referralCode && (
            <button
              onClick={() => { setMobileNavOpen(false); onShowReferral?.(); }}
              className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-up hover:bg-up/10 transition-all w-full text-left border border-up/20 bg-up/5"
            >
              <span className="w-5 text-center text-base leading-none">🎁</span>
              Refer & earn ₵10
            </button>
          )}

          {/* Logout */}
          <button
            onClick={() => { setMobileNavOpen(false); logout(); }}
            className="flex items-center gap-3 px-3 py-3 rounded-xl text-sm font-medium text-muted hover:text-down hover:bg-down/10 transition-all w-full text-left"
          >
            <span className="w-5 text-center text-base leading-none">→</span>
            Log out
          </button>
        </div>
      </div>
    </>
  );
}

function getPrec(asset?: string) {
  if (!asset) return 2;
  return ASSET_CONFIGS[asset]?.decimals ?? 2;
}
