"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import Link from "next/link";
import { setTokens } from "@/lib/api";
import { getSupabaseBrowser } from "@/lib/supabaseBrowser";

const REF_KEY = "skyvult_pending_ref";

function AuthForm() {
  const params = useSearchParams();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  // Referral code — pre-filled from ?ref= so share links auto-populate. Hidden
  // from the login form; only relevant during register.
  const [referralCode, setReferralCode] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauthBusy, setOauthBusy] = useState<"google" | null>(null);
  // Gate render until mounted so server HTML and first client paint always
  // match — avoids hydration mismatches from search params, client state, and
  // password-manager/extension DOM injection that's common on auth forms.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Domain suggestions — show common providers once user types "@"
  const DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com"];
  const atIdx = email.indexOf("@");
  const afterAt = atIdx !== -1 ? email.slice(atIdx + 1) : "";
  const emailSuggestions = atIdx !== -1 && !afterAt.includes(".")
    ? DOMAINS.filter((d) => d.startsWith(afterAt)).slice(0, 4)
    : [];

  useEffect(() => {
    if (params.get("mode") === "register") setMode("register");
    const ref = params.get("ref");
    if (ref) {
      setReferralCode(ref);
      setMode("register"); // arriving with a ref code always means "go register"
    }
  }, [params]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const url = mode === "login" ? "/api/auth/login" : "/api/auth/register";
      const body = mode === "login"
        ? { email, password }
        : { name, email, password, ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}) };
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Failed");
      setTokens(data.accessToken, data.refreshToken);
      window.location.href = "/trade";
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function signInWithProvider(provider: "google") {
    setError(null);
    setOauthBusy(provider);
    try {
      // Stash the referral code so it survives the OAuth redirect round-trip.
      if (referralCode.trim()) sessionStorage.setItem(REF_KEY, referralCode.trim());
      const supabase = getSupabaseBrowser();
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: `${window.location.origin}/auth/callback` },
      });
      if (error) throw error;
      // On success the browser navigates away to the provider — nothing else to do.
    } catch (e: any) {
      setError(e?.message ?? `Could not start ${provider} sign-in`);
      setOauthBusy(null);
    }
  }

  // Stable shell on the server / first paint — replaced once mounted.
  if (!mounted) return <main className="min-h-screen bg-bg" />;

  return (
    <main className="min-h-screen flex flex-col lg:flex-row">
      {/* Left panel — hidden on mobile */}
      <div className="hidden lg:flex flex-1 flex-col justify-between bg-panel border-r border-border p-10 relative overflow-hidden">
        <div className="absolute inset-0 bg-accent/5 pointer-events-none" />
        <Link href="/" className="flex items-center gap-2 relative z-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/SkyVult logo.png" alt="SkyVult" width={32} height={32} className="rounded-lg object-contain" />
          <span className="font-bold text-lg">SkyVult</span>
        </Link>
        <div className="relative z-10 flex flex-col items-center gap-8">
          <Image src="/phone.png" alt="SkyVult app" width={260} height={480} className="drop-shadow-2xl" />
          <div className="text-center">
            <div className="text-2xl font-bold">Trade UP or DOWN</div>
            <div className="text-muted mt-2">80% payout · Live prices · Start from ₵10</div>
          </div>
        </div>
        <div className="text-xs text-muted relative z-10">Educational & demo use only</div>
      </div>

      {/* Right panel — full width on mobile */}
      <div className="flex-1 flex items-center justify-center px-5 py-10 lg:py-0">
        <div className="w-full max-w-sm">
          {/* Mobile logo */}
          <Link href="/" className="flex items-center gap-2 mb-8 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/SkyVult logo.png" alt="SkyVult" width={32} height={32} className="rounded-lg object-contain" />
            <span className="font-bold text-lg">SkyVult</span>
          </Link>

          <h1 className="text-2xl font-bold">
            {mode === "login" ? "Welcome back" : "Create account"}
          </h1>
          <p className="text-muted text-sm mt-1">
            {mode === "login"
              ? "Sign in to your SkyVult account."
              : "Get ₵10,000 demo free. Go live from just ₵10."}
          </p>

          {/* Toggle */}
          <div className="flex gap-1 mt-6 bg-panel2 rounded-lg p-1">
            {(["login", "register"] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={`flex-1 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  mode === m ? "bg-accent text-black" : "text-muted hover:text-white"
                }`}
              >
                {m === "login" ? "Login" : "Register"}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="mt-5 space-y-3">
            {mode === "register" && (
              <input
                className="input"
                type="text"
                placeholder="Full name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoComplete="name"
              />
            )}
            <div>
              <input
                className="input"
                type="email"
                placeholder="Email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
              {emailSuggestions.length > 0 && (
                <div className="flex gap-1.5 mt-1.5 flex-wrap">
                  {emailSuggestions.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setEmail(email.slice(0, atIdx + 1) + d)}
                      className="text-[11px] px-2.5 py-1 rounded-full bg-panel2 border border-border text-muted hover:border-accent hover:text-accent transition-colors font-mono"
                    >
                      @{d}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="relative">
              <input
                className="input pr-10"
                type={showPassword ? "text" : "password"}
                placeholder="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={8}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted hover:text-white transition-colors"
                tabIndex={-1}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                )}
              </button>
            </div>
            {/* Optional referral code on register. Auto-filled from `?ref=`
                in the URL when someone arrives via a share link. */}
            {mode === "register" && (
              <input
                className="input"
                type="text"
                placeholder="Referral code (optional)"
                value={referralCode}
                onChange={(e) => setReferralCode(e.target.value)}
                maxLength={32}
                autoCapitalize="characters"
                autoComplete="off"
              />
            )}
            {error && (
              <div className="text-down text-sm bg-down/10 border border-down/20 rounded-md px-3 py-2">
                {error}
              </div>
            )}
            <button type="submit" disabled={loading} className="btn btn-primary w-full py-2.5">
              {loading
                ? "Please wait…"
                : mode === "login"
                ? "Sign in"
                : "Create account"}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-5">
            <div className="flex-1 h-px bg-border" />
            <span className="text-[11px] text-muted uppercase tracking-wider">or continue with</span>
            <div className="flex-1 h-px bg-border" />
          </div>

          {/* Social sign-in */}
          <div className="space-y-2.5">
            <button
              type="button"
              onClick={() => signInWithProvider("google")}
              disabled={!!oauthBusy}
              className="w-full flex items-center justify-center gap-3 py-2.5 rounded-lg border border-border bg-white text-black font-medium text-sm hover:bg-white/90 disabled:opacity-60 transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.71-1.57 2.68-3.89 2.68-6.62Z"/>
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z"/>
                <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z"/>
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z"/>
              </svg>
              {oauthBusy === "google" ? "Redirecting…" : "Continue with Google"}
            </button>

          </div>

          <div className="mt-5 text-xs text-muted text-center leading-relaxed">
            By continuing you agree to our{" "}
            <Link href="/terms" className="text-accent hover:underline">Terms of Service</Link>{" "}
            and{" "}
            <Link href="/privacy" className="text-accent hover:underline">Privacy Policy</Link>.
          </div>
        </div>
      </div>
    </main>
  );
}

export default function AuthPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-bg" />}>
      <AuthForm />
    </Suspense>
  );
}
