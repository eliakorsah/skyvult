import crypto from "crypto";

/** Paystack REST wrapper. Server-only — never import in a client component
 *  (PAYSTACK_SECRET_KEY has no NEXT_PUBLIC_ prefix and would resolve to
 *  undefined in the browser anyway). All amounts cross this boundary in
 *  PESEWAS (smallest GHS denomination) since that's what Paystack expects.
 */

const API_BASE = process.env.PAYSTACK_BASE_URL || "https://api.paystack.co";
const SECRET   = process.env.PAYSTACK_SECRET_KEY || "";

if (!SECRET && typeof window === "undefined") {
  // Loud, non-fatal warning. Payment endpoints will 500 until configured.
  // eslint-disable-next-line no-console
  console.warn("[paystack] PAYSTACK_SECRET_KEY not set — deposits + withdrawals are disabled until configured in .env.local");
}

/** Paystack provider codes for the /charge (deposit) API — lowercase. */
export const MOBILE_PROVIDERS = {
  MTN:       "mtn",
  TELECEL:   "vod",   // legacy Vodafone code — Paystack still uses this
  AIRTELTIGO:"tgo",
} as const;
export type MobileProvider = keyof typeof MOBILE_PROVIDERS;

/** Paystack bank_code values for the /transferrecipient (withdrawal) API.
 *  Different format from the charge codes above — Paystack uses uppercase
 *  bank codes here; sending the charge codes causes "bank is invalid". */
const TRANSFER_BANK_CODES: Record<MobileProvider, string> = {
  MTN:       "MTN",
  TELECEL:   "VOD",
  AIRTELTIGO:"ATL",
};

function isMobileProvider(s: string): s is MobileProvider {
  return s === "MTN" || s === "TELECEL" || s === "AIRTELTIGO";
}

/** Cedi → pesewa for outbound Paystack calls. */
const toMinor = (ghs: number) => Math.round(ghs * 100);

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

/** Initiate a MoMo charge. Paystack returns immediately with `status:
 *  "send_otp"` or `"pay_offline"`; the user receives a USSD push on their
 *  phone and enters their PIN. Final outcome lands on our webhook. */
export async function chargeMobileMoney(opts: {
  amountGhs: number;
  email: string;
  phone: string;          // local format e.g. "0241234567"
  provider: MobileProvider;
  reference: string;      // OUR internal reference; Paystack echoes it back on webhook
}): Promise<{ status: string; reference: string; message?: string }> {
  const body = await paystackFetch<{ data: { status: string; reference: string; gateway_response?: string } }>("/charge", {
    method: "POST",
    body: JSON.stringify({
      amount:   toMinor(opts.amountGhs),
      email:    opts.email,
      currency: "GHS",
      reference: opts.reference,
      mobile_money: {
        phone:    opts.phone,
        provider: MOBILE_PROVIDERS[opts.provider],
      },
    }),
  });
  return {
    status:    body.data.status,
    reference: body.data.reference,
    message:   body.data.gateway_response,
  };
}

/** Verify a charge by reference — used as a fallback when the webhook is
 *  late or has been missed (e.g. ngrok tunnel dropped during dev). */
export async function verifyCharge(reference: string) {
  return paystackFetch<{ data: {
    status: string;          // "success" | "failed" | "abandoned" | "pending"
    amount: number;          // in pesewas
    reference: string;
    gateway_response?: string;
  } }>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

// ─── Transfers (withdrawals) ────────────────────────────────────────────

/** Step 1 of a withdrawal: create a transfer recipient for the user's MoMo.
 *  Paystack returns a recipient_code we then use in the transfer call. */
export async function createMobileMoneyRecipient(opts: {
  name:     string;
  phone:    string;
  provider: MobileProvider;
}): Promise<{ recipientCode: string }> {
  const body = await paystackFetch<{ data: { recipient_code: string } }>("/transferrecipient", {
    method: "POST",
    body: JSON.stringify({
      type:           "mobile_money",
      name:           opts.name,
      account_number: opts.phone,
      bank_code:      TRANSFER_BANK_CODES[opts.provider],
      currency:       "GHS",
    }),
  });
  return { recipientCode: body.data.recipient_code };
}

/** Step 2: initiate the actual transfer. Final outcome lands on webhook. */
export async function initiateTransfer(opts: {
  amountGhs:     number;
  recipientCode: string;
  reference:     string;   // our internal reference for idempotency
  reason?:       string;
}): Promise<{ transferCode: string; status: string }> {
  const body = await paystackFetch<{ data: { transfer_code: string; status: string } }>("/transfer", {
    method: "POST",
    body: JSON.stringify({
      source:    "balance",
      amount:    toMinor(opts.amountGhs),
      recipient: opts.recipientCode,
      reason:    opts.reason ?? "SkyVult withdrawal",
      reference: opts.reference,
    }),
  });
  return { transferCode: body.data.transfer_code, status: body.data.status };
}

// ─── Webhook signature ──────────────────────────────────────────────────

/** Verify Paystack's HMAC-SHA512 signature on an incoming webhook. The
 *  string we hash must be the EXACT raw request body — JSON-stringifying a
 *  parsed body re-orders keys and breaks the signature. The webhook route
 *  uses req.text() to preserve raw bytes. */
export function verifyWebhookSignature(rawBody: string, signatureHeader: string | null): boolean {
  if (!signatureHeader || !SECRET) return false;
  const hash = crypto.createHmac("sha512", SECRET).update(rawBody).digest("hex");
  // Constant-time compare — defeats timing-attack signature probes
  const a = Buffer.from(hash);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

// ─── Helpers ────────────────────────────────────────────────────────────

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

/** Best-effort guess of the network from the leading digits of a Ghana
 *  MoMo number. Used to pre-fill the provider select on the deposit form
 *  but the user can override (some prefixes have been ported between
 *  networks). Not authoritative — Paystack still validates server-side. */
export function guessProviderFromPhone(local10: string): MobileProvider | null {
  if (local10.length !== 10) return null;
  const p = local10.slice(1, 3); // chars 1-3 (after the leading 0)
  // MTN: 24, 25, 53, 54, 55, 59
  if (["24","25","53","54","55","59"].includes(p)) return "MTN";
  // Telecel (ex-Vodafone): 20, 50
  if (["20","50"].includes(p)) return "TELECEL";
  // AirtelTigo: 26, 27, 28, 56, 57
  if (["26","27","28","56","57"].includes(p)) return "AIRTELTIGO";
  return null;
}

export { isMobileProvider };
