import crypto from "crypto";

/** Korapay (Kora) REST wrapper. Server-only — never import in a client
 *  component (KORAPAY_SECRET_KEY has no NEXT_PUBLIC_ prefix).
 *
 *  ⚠️ KEY DIFFERENCES FROM PAYSTACK (verify against your Korapay dashboard
 *  docs at https://docs.korapay.com before going live):
 *    1. AMOUNTS ARE IN MAJOR UNITS (cedis), not pesewas. No ×100 conversion.
 *    2. Webhook signature is HMAC-SHA256 over JSON.stringify(payload.data)
 *       only — NOT the whole raw body, and SHA256 not SHA512.
 *    3. Endpoints live under /merchant/api/v1/.
 */

const API_BASE = process.env.KORAPAY_BASE_URL || "https://api.korapay.com";
const SECRET   = process.env.KORAPAY_SECRET_KEY || "";

if (!SECRET && typeof window === "undefined") {
  // Loud, non-fatal warning. Payment endpoints will 500 until configured.
  // eslint-disable-next-line no-console
  console.warn("[korapay] KORAPAY_SECRET_KEY not set — deposits are disabled until configured in .env.local");
}

/** Korapay `mobile_money.network` values (Ghana). Korapay's enum is shared
 *  across countries and capitalised — TELECEL maps to "Vodafone" (its legacy
 *  brand on Korapay's side) and AIRTELTIGO to "Tigo" (AirtelTigo Money's
 *  legacy "Tigo Cash" brand); there is no "AirtelTigo" enum value. */
export const MOBILE_PROVIDERS = {
  MTN:        "Mtn",
  TELECEL:    "Vodafone",
  AIRTELTIGO: "Tigo",
} as const;
export type MobileProvider = keyof typeof MOBILE_PROVIDERS;

function isMobileProvider(s: string): s is MobileProvider {
  return s === "MTN" || s === "TELECEL" || s === "AIRTELTIGO";
}

async function koraFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (!SECRET) throw new Error("Korapay not configured");
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Authorization": `Bearer ${SECRET}`,
      "Content-Type":  "application/json",
      ...(init.headers as Record<string, string> | undefined),
    },
    // Don't let Next cache provider calls — they're stateful and time-sensitive.
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  // Korapay envelopes responses as { status: boolean, message, data }.
  if (!res.ok || body?.status === false) {
    const msg = body?.message || `Korapay ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

// ─── Charges (deposits) ─────────────────────────────────────────────────

/** Initiate a mobile-money charge. Korapay returns immediately with a
 *  pending/processing status; the user authorises on their phone and the
 *  final outcome lands on our webhook. Amount is in CEDIS (major units). */
export async function chargeMobileMoney(opts: {
  amountGhs: number;
  email: string;
  phone: string;          // local format e.g. "0241234567"
  provider: MobileProvider;
  reference: string;      // OUR internal reference; Korapay echoes it back on webhook
  name?: string;
}): Promise<{ status: string; reference: string; message?: string }> {
  const body = await koraFetch<{ data: { reference: string; status: string; message?: string } }>(
    "/merchant/api/v1/charges/mobile-money",
    {
      method: "POST",
      body: JSON.stringify({
        reference: opts.reference,
        amount:    opts.amountGhs,          // major units — NO ×100
        currency:  "GHS",
        customer:  { email: opts.email, name: opts.name ?? opts.email },
        mobile_money: {
          number:  opts.phone,
          network: MOBILE_PROVIDERS[opts.provider],
        },
      }),
    },
  );
  return {
    status:    body.data.status,
    reference: body.data.reference,
    message:   body.data.message,
  };
}

/** Verify a charge by reference — fallback when the webhook is late/missed.
 *  Korapay status values: "success" | "processing" | "pending" | "failed"
 *  | "expired". */
export async function verifyCharge(reference: string) {
  return koraFetch<{ data: {
    status: string;
    amount: number;          // major units (cedis)
    reference: string;
    message?: string;
  } }>(`/merchant/api/v1/charges/${encodeURIComponent(reference)}`);
}

// ─── Webhook signature ──────────────────────────────────────────────────

/** Verify Korapay's webhook signature. Korapay signs the JSON-stringified
 *  `data` object (NOT the whole body) with HMAC-SHA256 using the secret key,
 *  delivered in the `x-korapay-signature` header. The caller must pass the
 *  already-parsed `data` object. */
export function verifyWebhookSignature(data: unknown, signatureHeader: string | null): boolean {
  if (!signatureHeader || !SECRET || data == null) return false;
  const hash = crypto.createHmac("sha256", SECRET).update(JSON.stringify(data)).digest("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── Helpers (provider-neutral; kept here so other modules import one place) ──

/** Normalise Ghana phone numbers to "0xxxxxxxxx" (10 digits). Accepts
 *  "+233xxxxxxxxx" and "233xxxxxxxxx" formats too. Returns null on garbage. */
export function normalizeGhanaPhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  let local: string;
  if (digits.startsWith("233")) local = "0" + digits.slice(3);
  else if (digits.startsWith("0")) local = digits;
  else if (digits.length === 9) local = "0" + digits;
  else return null;
  if (local.length !== 10) return null;
  return local;
}

/** Best-effort guess of the network from the leading digits of a Ghana MoMo
 *  number. Used to pre-fill the provider select; the user can override. */
export function guessProviderFromPhone(local10: string): MobileProvider | null {
  if (local10.length !== 10) return null;
  const p = local10.slice(1, 3); // chars 1-3 (after the leading 0)
  if (["24","25","53","54","55","59"].includes(p)) return "MTN";
  if (["20","50"].includes(p)) return "TELECEL";
  if (["26","27","28","56","57"].includes(p)) return "AIRTELTIGO";
  return null;
}

export { isMobileProvider };
