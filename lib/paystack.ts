import crypto from "crypto";

/** Paystack REST wrapper for Ghana Mobile Money charges. Server-only —
 *  never import in a client component (PAYSTACK_SECRET_KEY has no
 *  NEXT_PUBLIC_ prefix).
 *
 *  ⚠️ KEY DETAILS (verify against the Paystack dashboard docs at
 *  https://paystack.com/docs before going live):
 *    1. AMOUNTS ARE IN PESEWAS (subunits) — multiply cedis by 100.
 *    2. Webhook signature is HMAC-SHA512 over the RAW request body (the
 *       whole JSON, not just `data`) — header `x-paystack-signature`.
 *    3. mobile_money.provider for Ghana: "mtn" | "vod" (Telecel) | "atl"
 *       (AirtelTigo). MTN/AirtelTigo resolve via a USSD prompt
 *       (data.status === "pay_offline"); Telecel may require an OTP step
 *       (data.status === "send_otp") which isn't implemented here yet.
 */

const API_BASE = process.env.PAYSTACK_BASE_URL || "https://api.paystack.co";
const SECRET   = process.env.PAYSTACK_SECRET_KEY || "";

if (!SECRET && typeof window === "undefined") {
  // eslint-disable-next-line no-console
  console.warn("[paystack] PAYSTACK_SECRET_KEY not set — deposits are disabled until configured in .env.local");
}

export function isPaystackConfigured(): boolean {
  return Boolean(SECRET);
}

/** Paystack `mobile_money.provider` values (Ghana). */
export const MOBILE_PROVIDERS = {
  MTN:        "mtn",
  TELECEL:    "vod",
  AIRTELTIGO: "atl",
} as const;
export type MobileProvider = keyof typeof MOBILE_PROVIDERS;

function isMobileProvider(s: string): s is MobileProvider {
  return s === "MTN" || s === "TELECEL" || s === "AIRTELTIGO";
}

async function paystackFetch<T = any>(path: string, init: RequestInit = {}): Promise<T> {
  if (!SECRET) throw new Error("Paystack not configured");
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
  if (!res.ok || body?.status === false) {
    const msg = body?.message || `Paystack ${path} failed (${res.status})`;
    throw new Error(msg);
  }
  return body as T;
}

// ─── Charges (deposits) ─────────────────────────────────────────────────

/** Initiate a mobile-money charge. Paystack returns immediately with
 *  data.status === "pay_offline" (USSD prompt, no further action from us)
 *  or "send_otp" (the network requires an OTP — call submitOtp() with the
 *  code the user enters). The final outcome always lands on our webhook.
 *  Amount is in CEDIS (major units); converted to pesewas here. */
export async function chargeMobileMoney(opts: {
  amountGhs: number;
  email: string;
  phone: string;          // local format e.g. "0241234567"
  provider: MobileProvider;
  reference: string;      // OUR internal reference; Paystack echoes it back on webhook
}): Promise<{ status: string; reference: string; displayText?: string }> {
  const body = await paystackFetch<{ data: {
    status: string;
    reference: string;
    display_text?: string;
  } }>("/charge", {
    method: "POST",
    body: JSON.stringify({
      email:     opts.email,
      amount:    String(Math.round(opts.amountGhs * 100)), // pesewas — NO major units
      currency:  "GHS",
      reference: opts.reference,
      mobile_money: {
        phone:    opts.phone,
        provider: MOBILE_PROVIDERS[opts.provider],
      },
    }),
  });
  return {
    status:      body.data.status,
    reference:   body.data.reference,
    displayText: body.data.display_text,
  };
}

/** Submit the OTP code the user received for a "send_otp" charge.
 *  Response status is typically "pending" or "success" — either way the
 *  final wallet credit happens via the charge.success webhook. */
export async function submitOtp(otp: string, reference: string): Promise<{ status: string; displayText?: string }> {
  const body = await paystackFetch<{ data: {
    status: string;
    display_text?: string;
  } }>("/charge/submit_otp", {
    method: "POST",
    body: JSON.stringify({ otp, reference }),
  });
  return {
    status:      body.data.status,
    displayText: body.data.display_text,
  };
}

/** Verify a charge by reference — fallback when the webhook is late/missed.
 *  Paystack status values: "success" | "failed" | "abandoned" | "pending"
 *  (amount returned in pesewas). */
export async function verifyCharge(reference: string) {
  return paystackFetch<{ data: {
    status: string;
    amount: number;          // pesewas
    reference: string;
    gateway_response?: string;
  } }>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

// ─── Webhook signature ──────────────────────────────────────────────────

/** Verify Paystack's webhook signature. Paystack signs the RAW request
 *  body (HMAC-SHA512) with the secret key, delivered in the
 *  `x-paystack-signature` header. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !SECRET) return false;
  const hash = crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex");
  const a = Buffer.from(hash);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export { isMobileProvider };
