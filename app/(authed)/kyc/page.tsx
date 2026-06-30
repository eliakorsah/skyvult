"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";

type Status = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

/* ── Small inline icons ───────────────────────────────────────── */
function ShieldIcon({ className = "w-8 h-8" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6}
        d="M12 3l7 3v5c0 4.5-3 8.3-7 9.5C8 19.3 5 15.5 5 11V6l7-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M9.5 12l1.8 1.8L15 10" />
    </svg>
  );
}
function UserIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M12 12a4 4 0 100-8 4 4 0 000 8z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.6} d="M4 20c0-3.3 3.6-5 8-5s8 1.7 8 5" />
    </svg>
  );
}
function PhoneIcon({ className = "w-5 h-5" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <rect x="7" y="3" width="10" height="18" rx="2.5" strokeWidth={1.6} />
      <path strokeLinecap="round" strokeWidth={1.6} d="M11 18h2" />
    </svg>
  );
}
function CheckIcon({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} d="M5 13l4 4L19 7" />
    </svg>
  );
}

export default function KycPage() {
  const router = useRouter();
  const [kycStatus, setKycStatus] = useState<Status>("NONE");
  const [rejectionReason, setRejectionReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [accountName, setAccountName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [frontFile, setFrontFile] = useState<File | null>(null);
  const [frontPreview, setFrontPreview] = useState<string | null>(null);
  const [uploading, setUploading]  = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]          = useState<string | null>(null);

  const frontRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ kycStatus: Status; submission: any }>("/api/kyc")
      .then((d) => {
        setKycStatus(d.kycStatus);
        if (d.submission?.rejectionReason) setRejectionReason(d.submission.rejectionReason);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  function pickFront(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFrontFile(f);
    setFrontPreview(URL.createObjectURL(f));
  }

  async function uploadFile(file: File, slot: "front" | "back" | "selfie"): Promise<string> {
    const { signedUrl, path } = await api<{ signedUrl: string; path: string }>("/api/kyc/upload", {
      method: "POST",
      body:   JSON.stringify({
        filename:    file.name,
        contentType: file.type,
        sizeBytes:   file.size,
        slot,
      }),
    });
    const put = await fetch(signedUrl, {
      method:  "PUT",
      headers: { "Content-Type": file.type },
      body:    file,
    });
    if (!put.ok) throw new Error("Photo upload failed. Please try again.");
    return path;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!accountName.trim())  { setError("Please enter your mobile money account name."); return; }
    if (!mobileNumber.trim()) { setError("Please enter your mobile money number."); return; }
    if (!frontFile)           { setError("Please upload a photo of the front of your Ghana Card."); return; }

    try {
      setUploading(true);
      const frontPath = await uploadFile(frontFile, "front");
      setUploading(false);

      setSubmitting(true);
      await api("/api/kyc", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ accountName: accountName.trim(), mobileNumber: mobileNumber.trim(), frontPath }),
      });
      setKycStatus("PENDING");
    } catch (err: any) {
      setError(err?.message ?? "Submission failed. Please try again.");
    } finally {
      setUploading(false);
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  /* ── Terminal states (approved / pending) ───────────────────── */
  if (kycStatus === "APPROVED" || kycStatus === "PENDING") {
    const approved = kycStatus === "APPROVED";
    return (
      <div className="min-h-[100dvh] flex items-center justify-center px-5 py-10">
        <motion.div
          className="text-center max-w-sm w-full"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
        >
          <div
            className={`mx-auto mb-6 w-20 h-20 rounded-2xl flex items-center justify-center animate-popin ${
              approved ? "bg-up/15 ring-1 ring-up/40 text-up" : "bg-accent/15 ring-1 ring-accent/40 text-accent"
            }`}
          >
            <span className="text-4xl">{approved ? "✅" : "🕐"}</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">{approved ? "Identity Verified" : "Under Review"}</h1>
          <p className="text-muted text-sm mb-8 leading-relaxed">
            {approved
              ? "Your account is fully verified. You can deposit and withdraw freely."
              : "Your submission is being reviewed. This usually takes less than 24 hours — we'll let you know once it's done."}
          </p>
          <button
            onClick={() => router.push("/trade")}
            className="btn btn-primary w-full py-3.5 text-base"
          >
            {approved ? "Start Trading" : "Continue Trading"}
          </button>
        </motion.div>
      </div>
    );
  }

  /* ── Submission form ────────────────────────────────────────── */
  const nameOk  = accountName.trim().length >= 2;
  const phoneOk = mobileNumber.replace(/\D/g, "").length >= 9;
  const busy    = uploading || submitting;

  return (
    <div className="min-h-[100dvh] px-5 pt-8 pb-32 flex justify-center">
      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        {/* Header */}
        <div className="flex flex-col items-center text-center mb-7">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-accent/25 to-accent/5 ring-1 ring-accent/30 flex items-center justify-center text-accent mb-4">
            <ShieldIcon />
          </div>
          <h1 className="text-[1.6rem] leading-tight font-bold">Verify Your Identity</h1>
          <p className="text-muted text-sm mt-2 max-w-xs">
            Your MoMo details and a photo of your Ghana Card — that's all we need.
          </p>

          {/* Trust chips */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-panel2 border border-border px-3 py-1 text-[11px] text-muted">
              <svg className="w-3.5 h-3.5 text-up" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <rect x="5" y="11" width="14" height="9" rx="2" strokeWidth={1.8} />
                <path strokeWidth={1.8} strokeLinecap="round" d="M8 11V8a4 4 0 018 0v3" />
              </svg>
              Encrypted
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-panel2 border border-border px-3 py-1 text-[11px] text-muted">
              ⚡ Reviewed in ~24h
            </span>
          </div>
        </div>

        {kycStatus === "REJECTED" && (
          <div className="mb-5 bg-down/10 border border-down/30 rounded-xl p-4 text-sm">
            <p className="font-semibold text-down mb-1">Previous submission rejected</p>
            <p className="text-muted">{rejectionReason ?? "Please re-submit with a clear, well-lit photo."}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Account name */}
          <div>
            <label className="block text-sm font-medium mb-2">Mobile Money Account Name</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                <UserIcon />
              </span>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Name on your MoMo account"
                className="input !pl-11 !pr-10 h-12"
                autoComplete="name"
              />
              {nameOk && (
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-up">
                  <CheckIcon />
                </span>
              )}
            </div>
            <p className="text-muted text-xs mt-1.5">Must match the name on your Ghana Card.</p>
          </div>

          {/* Mobile number */}
          <div>
            <label className="block text-sm font-medium mb-2">Mobile Money Number</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none">
                <PhoneIcon />
              </span>
              <input
                type="tel"
                inputMode="numeric"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="024 123 4567"
                className="input !pl-11 !pr-10 h-12 font-mono tracking-wide"
                autoComplete="tel"
              />
              {phoneOk && (
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-up">
                  <CheckIcon />
                </span>
              )}
            </div>
            <p className="text-muted text-xs mt-1.5">Withdrawals are sent here once verified.</p>
          </div>

          {/* Front photo */}
          <div>
            <label className="block text-sm font-medium mb-2">Photo of your Ghana Card</label>
            <input ref={frontRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickFront} />

            {frontPreview ? (
              <div className="relative rounded-2xl overflow-hidden border border-border">
                <img src={frontPreview} alt="Ghana Card" className="w-full object-cover max-h-56" />
                <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 pt-8 pb-3">
                  <span className="inline-flex items-center gap-1.5 text-xs font-medium text-up">
                    <CheckIcon className="w-4 h-4" /> Photo added
                  </span>
                  <button
                    type="button"
                    onClick={() => frontRef.current?.click()}
                    className="text-xs font-semibold bg-white/15 hover:bg-white/25 backdrop-blur px-3 py-1.5 rounded-lg transition-colors"
                  >
                    Change
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => frontRef.current?.click()}
                className="w-full border-2 border-dashed border-border rounded-2xl px-4 py-7 flex flex-col items-center gap-2.5 text-muted hover:border-accent/50 hover:text-accent active:scale-[0.99] transition-all touch-manipulation"
              >
                <span className="w-11 h-11 rounded-full bg-panel2 flex items-center justify-center">
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                </span>
                <span className="text-sm font-medium text-white">Tap to take a photo</span>
                <span className="text-xs">Make sure all text is clear and readable</span>
              </button>
            )}
          </div>

          {error && (
            <div className="bg-down/10 border border-down/30 rounded-xl px-4 py-3 text-down text-sm text-center">
              {error}
            </div>
          )}
        </form>
      </motion.div>

      {/* Sticky submit bar — sits above the iOS home indicator */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-bg/90 backdrop-blur-md px-5 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
        <div className="max-w-md mx-auto">
          <button
            type="submit"
            onClick={handleSubmit}
            disabled={busy}
            className="btn btn-primary w-full py-3.5 text-base flex items-center justify-center gap-2"
          >
            {busy && <span className="w-4 h-4 border-2 border-black/40 border-t-black rounded-full animate-spin" />}
            {uploading ? "Uploading photo…" : submitting ? "Submitting…" : "Submit for Verification"}
          </button>
        </div>
      </div>
    </div>
  );
}
