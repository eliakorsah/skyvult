"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";

type KycStatus = "NONE" | "PENDING" | "APPROVED" | "REJECTED";

type Submission = {
  id: string;
  status: KycStatus;
  fullName: string;
  idType: string;
  idNumber: string;
  dateOfBirth: string;
  rejectionReason: string | null;
  submittedAt: string;
};

const ID_TYPES = [
  { value: "GHANA_CARD",      label: "Ghana Card (NIA)" },
  { value: "PASSPORT",        label: "International Passport" },
  { value: "DRIVERS_LICENSE", label: "Driver's License" },
];

const PROVIDERS = [
  { value: "MTN",        label: "MTN MoMo" },
  { value: "TELECEL",    label: "Telecel Cash" },
  { value: "AIRTELTIGO", label: "AirtelTigo Money" },
];

const CRITERIA = [
  { icon: "🪪", title: "Valid government-issued ID",  desc: "Ghana Card, Passport, or Driver's License — must not be expired." },
  { icon: "📸", title: "Clear, well-lit photo",       desc: "All four corners visible, text legible, no glare or shadows." },
  { icon: "✂️", title: "No editing or cropping",      desc: "Submit the original unedited photo. Filters will be rejected." },
  { icon: "🤳", title: "Selfie matches the ID",       desc: "Hold your ID beside your face. Both must be clearly visible." },
  { icon: "📱", title: "MoMo number matches your ID", desc: "The mobile number must be registered under your legal name." },
];

/** Format raw input into the Ghana Card pattern GHA-XXXXXXXXX-X.
 *  Strips non-digits, builds the dashes automatically as the user types. */
function formatGhanaCard(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 10);
  if (digits.length === 0) return "";
  if (digits.length <= 9)  return `GHA-${digits}`;
  return `GHA-${digits.slice(0, 9)}-${digits.slice(9)}`;
}

const ID_PLACEHOLDERS: Record<string, string> = {
  GHANA_CARD:      "GHA-000000000-0",
  PASSPORT:        "G1234567",
  DRIVERS_LICENSE: "DL-0000000000",
};

async function uploadFile(file: File, slot: "front" | "back" | "selfie"): Promise<string> {
  const { signedUrl, path } = await api<{ signedUrl: string; path: string }>("/api/kyc/upload", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, contentType: file.type, sizeBytes: file.size, slot }),
  });
  await fetch(signedUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
  return path;
}

export default function KycPage() {
  const [kycStatus,  setKycStatus]  = useState<KycStatus | null>(null);
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [loading,    setLoading]    = useState(true);

  const [fullName,        setFullName]        = useState("");
  const [dob,             setDob]             = useState("");
  const [idType,          setIdType]          = useState("GHANA_CARD");
  const [idNumber,        setIdNumber]        = useState("");
  const [mobileNumber,    setMobileNumber]    = useState("");
  const [mobileProvider,  setMobileProvider]  = useState("MTN");
  const [frontFile,       setFrontFile]       = useState<File | null>(null);
  const [backFile,        setBackFile]        = useState<File | null>(null);
  const [selfieFile,      setSelfieFile]      = useState<File | null>(null);
  const [progress,        setProgress]        = useState("");
  const [submitting,      setSubmitting]      = useState(false);
  const [error,           setError]           = useState<string | null>(null);
  const [done,            setDone]            = useState(false);

  const frontRef  = useRef<HTMLInputElement>(null);
  const backRef   = useRef<HTMLInputElement>(null);
  const selfieRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    api<{ kycStatus: KycStatus; submission: Submission | null }>("/api/kyc")
      .then((d) => { setKycStatus(d.kycStatus); setSubmission(d.submission); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!frontFile) { setError("A photo of the front of your ID is required."); return; }
    setError(null);
    setSubmitting(true);
    try {
      setProgress("Uploading front of ID…");
      const frontPath = await uploadFile(frontFile, "front");

      let backPath: string | undefined;
      if (backFile) { setProgress("Uploading back of ID…"); backPath = await uploadFile(backFile, "back"); }

      let selfiePath: string | undefined;
      if (selfieFile) { setProgress("Uploading selfie…"); selfiePath = await uploadFile(selfieFile, "selfie"); }

      setProgress("Submitting for review…");
      await api("/api/kyc", {
        method: "POST",
        body: JSON.stringify({ fullName, dateOfBirth: dob, idType, idNumber, mobileNumber, mobileProvider, frontPath, backPath, selfiePath }),
      });
      setKycStatus("PENDING");
      setDone(true);
    } catch (err: any) {
      setError(err?.message ?? "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  }

  if (loading) return <main className="min-h-screen bg-bg" />;

  if (kycStatus === "APPROVED") return (
    <main className="min-h-screen bg-bg flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="card p-8 border-t-4 border-t-up text-center">
          <div className="text-5xl mb-4">✅</div>
          <h1 className="text-xl font-bold text-up mb-2">Identity Verified</h1>
          <p className="text-sm text-muted mb-4">Your account is fully verified. You can withdraw freely.</p>
          {submission && (
            <div className="bg-panel2 rounded-lg px-4 py-3 text-left text-xs text-muted space-y-1">
              <p><span className="text-white font-medium">Name:</span> {submission.fullName}</p>
              <p><span className="text-white font-medium">ID:</span> {submission.idType?.replace(/_/g, " ") ?? "—"} · {submission.idNumber ?? "—"}</p>
            </div>
          )}
        </div>
      </div>
    </main>
  );

  if (kycStatus === "PENDING" && !done) return (
    <main className="min-h-screen bg-bg flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="card p-8 border-t-4 border-t-accent text-center">
          <div className="text-5xl mb-4">⏳</div>
          <h1 className="text-xl font-bold text-accent mb-2">Under Review</h1>
          <p className="text-sm text-muted">We're reviewing your documents. This usually takes a few hours.</p>
          {submission && <p className="text-xs text-muted mt-3 font-mono">Submitted {new Date(submission.submittedAt).toLocaleDateString()}</p>}
        </div>
      </div>
    </main>
  );

  if (done) return (
    <main className="min-h-screen bg-bg flex items-start justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="card p-8 border-t-4 border-t-accent text-center">
          <div className="text-5xl mb-4">📬</div>
          <h1 className="text-xl font-bold text-accent mb-2">Documents Submitted!</h1>
          <p className="text-sm text-muted">Our team will review your identity within a few hours.</p>
        </div>
      </div>
    </main>
  );

  return (
    <main className="min-h-screen bg-bg overflow-x-hidden">
      <div className="w-full max-w-2xl mx-auto px-4 py-8 pb-16">

        <div className="mb-6">
          <h1 className="text-2xl font-bold tracking-tight">Identity Verification</h1>
          <p className="text-sm text-muted mt-1">Verify your identity to unlock withdrawals and full account access.</p>
        </div>

        {kycStatus === "REJECTED" && submission?.rejectionReason && (
          <div className="mb-5 rounded-xl border border-down/30 bg-down/10 px-4 py-3">
            <p className="text-sm font-semibold text-down mb-0.5">Previous submission rejected</p>
            <p className="text-xs text-down/80">{submission.rejectionReason}</p>
            <p className="text-xs text-muted mt-1">Please resubmit with the correct documents below.</p>
          </div>
        )}

        {/* Criteria */}
        <div className="mb-6">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Requirements</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {CRITERIA.map((c) => (
              <div key={c.title} className="flex items-start gap-3 rounded-xl bg-panel2 border border-border px-4 py-3">
                <span className="text-xl flex-shrink-0 mt-0.5">{c.icon}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-white">{c.title}</p>
                  <p className="text-[11px] text-muted leading-snug mt-0.5">{c.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-5">

          {/* Personal details */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Personal details</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Full legal name *</label>
                <input className="input" placeholder="As it appears on your ID" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Date of birth *</label>
                <input className="input" type="date" value={dob} onChange={(e) => setDob(e.target.value)} required
                  max={new Date(Date.now() - 18 * 365.25 * 24 * 3600 * 1000).toISOString().slice(0, 10)} />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">ID type *</label>
                <select className="input" value={idType} onChange={(e) => { setIdType(e.target.value); setIdNumber(""); }}>
                  {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">ID number *</label>
                <input
                  className="input font-mono tracking-widest"
                  placeholder={ID_PLACEHOLDERS[idType] ?? "Enter ID number"}
                  value={idNumber}
                  onChange={(e) => {
                    const raw = e.target.value;
                    setIdNumber(idType === "GHANA_CARD" ? formatGhanaCard(raw) : raw);
                  }}
                  required
                />
              </div>
            </div>
          </div>

          {/* Mobile Money number */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Mobile Money number</h2>
            <p className="text-[11px] text-muted mb-3 leading-relaxed">
              This number must be registered under the <span className="text-white font-medium">same name as your ID</span>. It will be used automatically for all your withdrawals — no re-entry needed.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">MoMo phone number *</label>
                <input className="input font-mono" type="tel" inputMode="tel" placeholder="0241234567"
                  value={mobileNumber} onChange={(e) => setMobileNumber(e.target.value)} required />
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1.5">Network *</label>
                <div className="grid grid-cols-3 gap-1.5">
                  {PROVIDERS.map((p) => (
                    <button
                      type="button"
                      key={p.value}
                      onClick={() => setMobileProvider(p.value)}
                      className={`tab text-xs py-2 ${mobileProvider === p.value ? "tab-active" : "tab-idle bg-panel2"}`}
                    >
                      {p.label.split(" ")[0]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Document uploads */}
          <div>
            <h2 className="text-xs font-semibold uppercase tracking-wider text-muted mb-3">Document photos</h2>
            <div className="grid grid-cols-3 gap-2 sm:gap-3">
              <FileSlot label="Front of ID" required hint="Name & photo visible" file={frontFile} inputRef={frontRef} onChange={setFrontFile} />
              <FileSlot label="Back of ID"  hint="Recommended" file={backFile} inputRef={backRef} onChange={setBackFile} />
              <FileSlot label="Selfie"      hint="Hold ID beside face" file={selfieFile} inputRef={selfieRef} onChange={setSelfieFile} />
            </div>
            <p className="text-[11px] text-muted mt-2">JPEG, PNG, WEBP, HEIC or PDF · Max 10 MB each</p>
          </div>

          {error    && <div className="rounded-xl border border-down/30 bg-down/10 px-4 py-3 text-sm text-down">{error}</div>}
          {progress && <div className="flex items-center gap-2 text-sm text-accent"><span className="animate-pulse">⏳</span> {progress}</div>}

          <button type="submit" disabled={submitting}
            className="w-full py-3.5 rounded-xl bg-accent text-black font-bold text-sm hover:opacity-90 disabled:opacity-50 transition-opacity">
            {submitting ? "Submitting…" : "Submit for verification"}
          </button>

          <p className="text-[11px] text-muted text-center leading-relaxed">
            Your documents are encrypted and stored securely, accessed only by our compliance team for identity verification.
          </p>
        </form>
      </div>
    </main>
  );
}

function FileSlot({ label, hint, required = false, file, inputRef, onChange }: {
  label: string; hint: string; required?: boolean;
  file: File | null; inputRef: React.RefObject<HTMLInputElement>; onChange: (f: File | null) => void;
}) {
  const preview = file && file.type.startsWith("image/") ? URL.createObjectURL(file) : null;
  return (
    <div className="flex flex-col gap-1.5 min-w-0">
      <label className="text-[11px] font-medium text-muted truncate">
        {label}{required && <span className="text-down ml-0.5">*</span>}
      </label>
      <div
        onClick={() => inputRef.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed cursor-pointer transition-colors min-h-[90px] overflow-hidden
          ${file ? "border-accent/50 bg-accent/5" : "border-border hover:border-accent/40 bg-panel2"}`}
      >
        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt={label} className="absolute inset-0 w-full h-full object-cover opacity-60" />
        )}
        <div className={`relative z-10 flex flex-col items-center gap-1 px-2 text-center ${preview ? "bg-bg/70 rounded-lg p-1" : ""}`}>
          {file
            ? <><span className="text-base">{file.type.startsWith("image/") ? "🖼️" : "📄"}</span><span className="text-[10px] font-medium text-white truncate max-w-[80px]">{file.name}</span></>
            : <><span className="text-xl text-muted">+</span><span className="text-[10px] text-muted leading-tight">{hint}</span></>
          }
        </div>
        {file && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onChange(null); }}
            className="absolute top-1 right-1 z-20 w-4 h-4 rounded-full bg-down/80 text-white text-[9px] flex items-center justify-center">✕</button>
        )}
      </div>
      <input ref={inputRef} type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </div>
  );
}
