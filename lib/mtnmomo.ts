import crypto from "crypto";

/** MTN MoMo collections via the api.mtn.com gateway ("Payments V1" product).
 *  Server-only. Used as the PRIMARY rail for MTN numbers; Korapay is the
 *  fallback (see the deposit route).
 *
 *  ⚠️ ENDPOINT PATHS / TARGET ENV ARE GATEWAY-SPECIFIC. The OAuth2 +
 *  request-to-pay shape below follows MTN's standard collections flow, but the
 *  EXACT paths and the X-Target-Environment value differ per product. Confirm
 *  these against your "Payments V1" API spec on developers.mtn.com and override
 *  via the MTN_* env vars if they differ. Defaults are best-effort.
 */

const API_BASE        = process.env.MTN_API_BASE || "https://api.mtn.com";
const KEY             = process.env.MTN_CONSUMER_KEY || "";
const SECRET          = process.env.MTN_CONSUMER_SECRET || "";
const SUBSCRIPTION    = process.env.MTN_SUBSCRIPTION_KEY || ""; // Ocp-Apim-Subscription-Key, if the product requires it
const TARGET_ENV      = process.env.MTN_TARGET_ENVIRONMENT || "mtnghana";
const CALLBACK_URL    = process.env.MTN_CALLBACK_URL || "";     // e.g. https://skyvult.com/api/payments/mtn-callback
// Overridable path (default follows MTN's collections convention).
const REQUESTTOPAY_PATH = process.env.MTN_COLLECTION_PATH || "/collection/v1_0/requesttopay";

export function isMtnConfigured(): boolean {
  return Boolean(KEY && SECRET);
}

if (!isMtnConfigured() && typeof window === "undefined") {
  // eslint-disable-next-line no-console
  console.warn("[mtnmomo] MTN_CONSUMER_KEY/SECRET not set — MTN rail disabled; deposits fall back to Korapay");
}

// ─── OAuth token (cached) ────────────────────────────────────────────────
let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (!isMtnConfigured()) throw new Error("MTN not configured");
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) return cachedToken.token;

  // api.mtn.com OAuth V1: grant_type is a QUERY param, client_id/client_secret
  // go in the form-encoded body. (Confirmed working against the real API —
  // other combinations return a gateway-level 400 with no useful detail.)
  const res = await fetch(`${API_BASE}/v1/oauth/access_token?grant_type=client_credentials`, {
    method:  "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:    `client_id=${encodeURIComponent(KEY)}&client_secret=${encodeURIComponent(SECRET)}`,
    cache:   "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body?.access_token) {
    throw new Error(body?.faultMessage || body?.error_description || body?.message || `MTN token failed (${res.status})`);
  }
  const ttlSec = Number(body.expires_in) || 3600;
  cachedToken = { token: body.access_token, expiresAt: Date.now() + ttlSec * 1000 };
  return cachedToken.token;
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/** Local "0241234567" → MSISDN "233241234567" (no leading +, no leading 0). */
export function toMsisdn(local10: string): string {
  return "233" + local10.replace(/^0/, "");
}

// ─── Request to pay (collection) ─────────────────────────────────────────

/** Initiate an MTN MoMo collection. Returns the referenceId (a UUID we
 *  generate) that identifies the transaction — store it as provider_reference
 *  and use it to poll status / match the callback. MTN replies 202 with no
 *  body; the real outcome is confirmed by polling getCollectionStatus. */
export async function requestToPay(opts: {
  amountGhs: number;
  phone: string;        // local 10-digit "0241234567"
  externalId: string;   // our internal reference, for our own records
  referenceId?: string; // pre-generated UUID (so callers can persist it first)
  payerMessage?: string;
}): Promise<{ referenceId: string }> {
  const token = await getAccessToken();
  const referenceId = opts.referenceId ?? crypto.randomUUID();

  const res = await fetch(`${API_BASE}${REQUESTTOPAY_PATH}`, {
    method: "POST",
    headers: {
      "Authorization":         `Bearer ${token}`,
      "X-Reference-Id":        referenceId,
      "X-Target-Environment":  TARGET_ENV,
      "Content-Type":          "application/json",
      ...(SUBSCRIPTION ? { "Ocp-Apim-Subscription-Key": SUBSCRIPTION } : {}),
      ...(CALLBACK_URL ? { "X-Callback-Url": CALLBACK_URL } : {}),
    },
    body: JSON.stringify({
      amount:      String(opts.amountGhs),   // major units (cedis), as a string
      currency:    "GHS",
      externalId:  opts.externalId,
      payer:       { partyIdType: "MSISDN", partyId: toMsisdn(opts.phone) },
      payerMessage: opts.payerMessage ?? "SkyVult deposit",
      payeeNote:    "SkyVult deposit",
    }),
    cache: "no-store",
  });

  // 202 Accepted = charge initiated. Anything else is a synchronous failure.
  if (res.status !== 202 && res.status !== 200) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || `MTN requesttopay failed (${res.status})`);
  }
  return { referenceId };
}

/** Poll the status of a collection. Returns one of MTN's lifecycle states. */
export async function getCollectionStatus(referenceId: string): Promise<{
  status: "SUCCESSFUL" | "FAILED" | "PENDING" | "UNKNOWN";
  amountGhs?: number;
  reason?: string;
}> {
  const token = await getAccessToken();
  const res = await fetch(`${API_BASE}${REQUESTTOPAY_PATH}/${encodeURIComponent(referenceId)}`, {
    method:  "GET",
    headers: {
      "Authorization":        `Bearer ${token}`,
      "X-Target-Environment": TARGET_ENV,
      ...(SUBSCRIPTION ? { "Ocp-Apim-Subscription-Key": SUBSCRIPTION } : {}),
    },
    cache: "no-store",
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.message || `MTN status failed (${res.status})`);

  const raw = String(body?.status ?? "").toUpperCase();
  const status =
    raw === "SUCCESSFUL" ? "SUCCESSFUL" :
    raw === "FAILED"     ? "FAILED" :
    raw === "PENDING"    ? "PENDING" : "UNKNOWN";

  return {
    status,
    amountGhs: body?.amount != null ? Number(body.amount) : undefined,
    reason:    body?.reason,
  };
}
