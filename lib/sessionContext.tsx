"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

/** Tiny cross-page state that the Nav and the Trade page both need to
 *  read/write. The provider sits in app/(authed)/layout.tsx so it persists
 *  across navigations — without this, every tab switch would lose the
 *  DEMO/REAL toggle until the trade page re-mounts and re-reads localStorage.
 */
type SessionContextValue = {
  isDemo: boolean;
  setIsDemo: (v: boolean) => void;
  /** MTM floating equity pushed from the trade page at ~4fps.
   *  null = trade page not mounted / no data yet. */
  liveBalance: number | null;
  setLiveBalance: (v: number) => void;
};

const SessionCtx = createContext<SessionContextValue>({
  isDemo: true,
  setIsDemo: () => {},
  liveBalance: null,
  setLiveBalance: () => {},
});

const LS_KEY = "skyvult_is_demo";

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [isDemo, setIsDemoRaw] = useState(true);
  const [liveBalance, setLiveBalance] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = localStorage.getItem(LS_KEY);
    if (stored !== null) setIsDemoRaw(stored === "1");
  }, []);

  const setIsDemo = useCallback((v: boolean) => {
    setIsDemoRaw(v);
    if (typeof window !== "undefined") localStorage.setItem(LS_KEY, v ? "1" : "0");
  }, []);

  const setLiveBalanceCb = useCallback((v: number) => setLiveBalance(v), []);

  return (
    <SessionCtx.Provider value={{ isDemo, setIsDemo, liveBalance, setLiveBalance: setLiveBalanceCb }}>
      {children}
    </SessionCtx.Provider>
  );
}

export function useSession() {
  return useContext(SessionCtx);
}
