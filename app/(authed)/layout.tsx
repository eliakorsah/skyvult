"use client";

import { useState, useEffect } from "react";
import Nav from "@/components/Nav";
import ReferralPopup from "@/components/ReferralPopup";
import { SessionProvider, useSession } from "@/lib/sessionContext";
import { TOUR_LS_KEY } from "@/components/OnboardingTour";

/** Shared shell for every logged-in route (trade, history, wallet, admin).
 *  Persists across navigations so the Nav doesn't unmount/refetch each time
 *  you switch tabs. The Trade page consumes the same SessionContext, so the
 *  DEMO/REAL toggle stays in sync between the header and the trading UI. */
export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AuthedShell>{children}</AuthedShell>
    </SessionProvider>
  );
}

/** Inner shell — needs access to the session context so it can pass `isDemo`
 *  and `setIsDemo` into the Nav. Split out as a child of SessionProvider so
 *  the hook call sits inside the provider tree. */
function AuthedShell({ children }: { children: React.ReactNode }) {
  const { isDemo, setIsDemo, liveBalance } = useSession();
  const [referralOpen, setReferralOpen] = useState(false);
  // Don't mount ReferralPopup at all while the onboarding tour is active.
  // Listens for the tour-done event so it becomes available the moment the
  // user finishes or skips, without needing a full page reload.
  const [tourDone, setTourDone] = useState(() =>
    typeof window !== "undefined" && !!localStorage.getItem(TOUR_LS_KEY)
  );
  useEffect(() => {
    if (tourDone) return;
    const done = () => setTourDone(true);
    window.addEventListener("skyvult-tour-done", done);
    return () => window.removeEventListener("skyvult-tour-done", done);
  }, [tourDone]);

  return (
    <div className="flex flex-col h-[100dvh]">
      <Nav
        isDemo={isDemo}
        onToggleDemo={setIsDemo}
        liveBalance={liveBalance ?? undefined}
        onShowReferral={() => setReferralOpen(true)}
      />
      <div className="flex-1 min-h-0 overflow-auto">
        {children}
      </div>
      {tourDone && (
        <ReferralPopup forceOpen={referralOpen} onForceClose={() => setReferralOpen(false)} />
      )}
    </div>
  );
}
