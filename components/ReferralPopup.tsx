"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { TOUR_LS_KEY } from "./OnboardingTour";

const LS_KEY = "skyvult_ref_popup_seen";

export default function ReferralPopup({
  forceOpen = false,
  onForceClose,
}: {
  forceOpen?: boolean;
  onForceClose?: () => void;
}) {
  const [autoShow, setAutoShow] = useState(false);
  const [code, setCode]         = useState<string | null>(null);
  const [copied, setCopied]     = useState(false);
  // Tracks tour completion — re-evaluated on mount so even if setAutoShow fires
  // before the guard, this blocks rendering until the tour is done.
  const [tourDone, setTourDone] = useState(false);
  useEffect(() => {
    setTourDone(!!localStorage.getItem(TOUR_LS_KEY));
  }, []);

  // Auto-show once on first login — never while the onboarding tour is active
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (localStorage.getItem(LS_KEY)) return;
    if (!localStorage.getItem(TOUR_LS_KEY)) return;
    const t = setTimeout(async () => {
      try {
        const me = await api<{ referralCode: string | null }>("/api/auth/me");
        if (me.referralCode) { setCode(me.referralCode); setAutoShow(true); }
      } catch {}
    }, 800);
    return () => clearTimeout(t);
  }, []);

  // When force-opened, fetch code if we don't have it yet
  useEffect(() => {
    if (!forceOpen || code) return;
    api<{ referralCode: string | null }>("/api/auth/me")
      .then((me) => { if (me.referralCode) setCode(me.referralCode); })
      .catch(() => {});
  }, [forceOpen, code]);

  // Auto-show is only allowed after the tour is done — forceOpen (user clicked
  // the button) always works regardless.
  const show = forceOpen || (autoShow && tourDone);

  function dismiss() {
    localStorage.setItem(LS_KEY, "1");
    setAutoShow(false);
    onForceClose?.();
  }

  async function copyLink() {
    if (!code) return;
    const url = `${window.location.origin}/auth?mode=register&ref=${encodeURIComponent(code)}`;

    // Try modern clipboard API first (requires HTTPS or localhost with focus)
    if (navigator.clipboard && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2500);
        return;
      } catch {}
    }

    // Fallback: hidden textarea + execCommand — works on HTTP and LAN
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    try {
      document.execCommand("copy");
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {}
    document.body.removeChild(ta);
  }

  if (!show) return null;

  return (
    <>
      <div className="fixed inset-0 z-50 bg-black/60" onClick={dismiss} />

      <div className="fixed z-50 inset-x-4 bottom-6 md:inset-auto md:left-1/2 md:top-1/2 md:-translate-x-1/2 md:-translate-y-1/2 md:w-[380px] card p-6 shadow-2xl">
        <button onClick={dismiss} className="absolute top-3 right-3 text-muted hover:text-white text-lg leading-none">✕</button>

        <div className="w-12 h-12 rounded-full bg-up/15 border border-up/30 flex items-center justify-center text-2xl mb-4">🎁</div>

        <h2 className="text-lg font-bold tracking-tight mb-1">Earn free ₵30 GHS</h2>
        <p className="text-sm text-muted mb-4 leading-relaxed">
          Share your referral link. When a friend signs up and makes their first deposit, you earn <span className="text-up font-semibold">₵30 real money</span> — instantly added to your wallet.
        </p>

        <div className="bg-panel2 border border-border rounded-lg px-3 py-2 mb-3 flex items-center gap-2">
          <span className="font-mono text-sm text-accent flex-1 truncate">{code ?? "Loading…"}</span>
          <span className="text-[10px] text-muted uppercase tracking-wider">Your code</span>
        </div>

        <button
          onClick={copyLink}
          className="w-full py-2.5 rounded-lg bg-up text-black font-semibold text-sm hover:opacity-90 transition-opacity"
        >
          {copied ? "Link copied! Share it now ✓" : "Copy referral link"}
        </button>

        <button onClick={dismiss} className="w-full mt-2 py-2 text-xs text-muted hover:text-white transition-colors">
          Maybe later
        </button>
      </div>
    </>
  );
}
