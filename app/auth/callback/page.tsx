"use client";

import { useEffect, useRef, useState } from "react";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";
import { setTokens } from "@/lib/api";

const REF_KEY = "skyvult_pending_ref";

export default function OAuthCallback() {
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return;   // guard React Strict Mode double-run
    ran.current = true;

    (async () => {
      try {
        const supabase = getSupabaseBrowser();

        // PKCE: exchange the ?code= for a session. detectSessionInUrl may have
        // already done this; if so, getSession returns the established session.
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const oauthErr = url.searchParams.get("error_description") || url.searchParams.get("error");
        if (oauthErr) throw new Error(oauthErr);

        if (code) {
          await supabase.auth.exchangeCodeForSession(code).catch(() => {});
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.access_token) throw new Error("Sign-in did not complete. Please try again.");

        // Provision profile + wallet (idempotent) and pass any referral code
        // that was stashed before the redirect.
        const referralCode = sessionStorage.getItem(REF_KEY) || undefined;
        sessionStorage.removeItem(REF_KEY);

        const res = await fetch("/api/auth/oauth-init", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accessToken: session.access_token, referralCode }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data?.error || "Could not finish sign-in");

        // Hand the Supabase session tokens to the app's own storage.
        setTokens(session.access_token, session.refresh_token);
        window.location.href = "/trade";
      } catch (e: any) {
        setError(e?.message ?? "Sign-in failed");
      }
    })();
  }, []);

  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 text-center">
      {error ? (
        <>
          <div className="text-3xl mb-3">⚠️</div>
          <p className="text-down font-semibold mb-1">Sign-in failed</p>
          <p className="text-muted text-sm mb-6 max-w-xs">{error}</p>
          <a href="/auth" className="btn btn-primary px-6 py-2.5">Back to login</a>
        </>
      ) : (
        <>
          <div className="w-10 h-10 border-2 border-accent border-t-transparent rounded-full animate-spin mb-4" />
          <p className="text-muted text-sm tracking-wide">Completing sign-in…</p>
        </>
      )}
    </main>
  );
}
