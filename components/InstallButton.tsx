"use client";

import { useEffect, useState } from "react";

const KEY = "skyvult_install_prompted";

export default function InstallButton({ className }: { className?: string }) {
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);
  const [isIOS, setIsIOS]         = useState(false);
  const [installed, setInstalled] = useState(false);
  const [showBanner, setShowBanner] = useState(false);
  const [showIOSSheet, setShowIOSSheet] = useState(false);

  useEffect(() => {
    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
    const standalone =
      (window.navigator as any).standalone === true ||
      window.matchMedia("(display-mode: standalone)").matches;

    if (standalone) { setInstalled(true); return; }
    setIsIOS(ios);

    const alreadyPrompted = !!localStorage.getItem(KEY);

    if (ios) {
      // Auto-show our instruction banner after 3s on first visit
      if (!alreadyPrompted) {
        const t = setTimeout(() => setShowBanner(true), 3000);
        return () => clearTimeout(t);
      }
      return;
    }

    // Android / Desktop — capture the event, show our own banner after 3s
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);          // store for later user-gesture call
      if (!alreadyPrompted) {
        setTimeout(() => setShowBanner(true), 3000);
      }
    };

    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", () => { setInstalled(true); setShowBanner(false); });
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  // Called only from a real click — safe to call prompt() here
  async function handleInstall() {
    if (isIOS) {
      setShowIOSSheet(true);
      setShowBanner(false);
      localStorage.setItem(KEY, "1");
      return;
    }
    if (!deferredPrompt) return;
    localStorage.setItem(KEY, "1");
    setShowBanner(false);
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setInstalled(true);
    setDeferredPrompt(null);
  }

  function dismiss() {
    localStorage.setItem(KEY, "1");
    setShowBanner(false);
  }

  if (installed) return null;

  const canShow = isIOS || !!deferredPrompt;
  if (!canShow) return null;

  return (
    <>
      {/* Persistent inline button (always visible while installable) */}
      <button onClick={handleInstall} className={className ?? "btn-store"}>
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" className="flex-shrink-0">
          <rect x="3" y="3" width="18" height="18" rx="4" stroke="#f7a600" strokeWidth="1.5"/>
          <path d="M12 8v8M9 13l3 3 3-3" stroke="#f7a600" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <div className="text-left leading-tight">
          <div className="text-[10px] text-muted">Add to</div>
          <div className="text-sm font-semibold text-white">Home Screen</div>
        </div>
      </button>

      {/* Auto-shown bottom banner after 3s */}
      {showBanner && (
        <div className="fixed bottom-0 left-0 right-0 z-50 p-4 animate-slide-up">
          <div className="max-w-sm mx-auto bg-panel border border-accent/30 rounded-2xl p-4 shadow-2xl flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-accent grid place-items-center flex-shrink-0">
              <svg width="24" height="24" viewBox="0 0 40 40" fill="none">
                <path d="M20 8L29 21H24V32H16V21H11L20 8Z" fill="#050508"/>
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-sm">Install SkyVult</div>
              <div className="text-muted text-xs mt-0.5">Add to your home screen for the best experience</div>
            </div>
            <div className="flex flex-col gap-2 flex-shrink-0">
              <button onClick={handleInstall} className="btn btn-primary text-xs px-3 py-1.5 whitespace-nowrap">
                Install
              </button>
              <button onClick={dismiss} className="text-xs text-muted hover:text-white text-center">
                Not now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* iOS step-by-step sheet */}
      {showIOSSheet && <IOSSheet onClose={() => setShowIOSSheet(false)} />}
    </>
  );
}

function IOSSheet({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative bg-panel border-t border-border rounded-t-3xl px-5 pt-4 pb-10 animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-5" />
        <div className="flex items-center gap-3 mb-5">
          <div className="w-12 h-12 rounded-2xl bg-accent grid place-items-center flex-shrink-0">
            <svg width="24" height="24" viewBox="0 0 40 40" fill="none">
              <path d="M20 8L29 21H24V32H16V21H11L20 8Z" fill="#050508"/>
            </svg>
          </div>
          <div>
            <div className="font-bold text-base">Install SkyVult</div>
            <div className="text-muted text-xs mt-0.5">Add to your home screen for the best experience</div>
          </div>
        </div>
        <div className="space-y-3 mb-6">
          <Step n={1}>
            Tap the{" "}
            <span className="inline-flex items-center gap-1 font-semibold text-white">
              Share
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/>
                <polyline points="16 6 12 2 8 6"/>
                <line x1="12" y1="2" x2="12" y2="15"/>
              </svg>
            </span>{" "}
            button at the bottom of Safari
          </Step>
          <Step n={2}>
            Scroll down and tap{" "}
            <span className="text-accent font-semibold">Add to Home Screen</span>
          </Step>
          <Step n={3}>
            Tap <span className="text-white font-semibold">Add</span> in the top-right corner
          </Step>
        </div>
        <div className="flex flex-col items-center gap-1 mb-5 text-muted">
          <span className="text-xs">Share button is here</span>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-bounce-y text-accent">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <polyline points="19 12 12 19 5 12"/>
          </svg>
        </div>
        <button onClick={onClose} className="btn btn-secondary w-full py-3">Dismiss</button>
      </div>
    </div>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full bg-accent/20 border border-accent/40 text-accent text-xs font-bold grid place-items-center flex-shrink-0 mt-0.5">
        {n}
      </div>
      <p className="text-sm text-muted leading-relaxed">{children}</p>
    </div>
  );
}
