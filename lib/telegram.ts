/** Fire-and-forget Telegram alert helper. Never throws — a failed
 *  notification must never block the operation that triggered it.
 *
 *  Callers should `await tg(...)` before returning their HTTP response:
 *  on serverless the instance can freeze the moment the response is sent,
 *  dropping any in-flight (non-awaited) fetch — which makes alerts go silent. */

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN  || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID    || "";

// Warn once at boot if alerts are off, so a missing env in prod is obvious
// in the logs instead of failing silently forever.
let warnedUnconfigured = false;

export function isTelegramConfigured(): boolean {
  return Boolean(TOKEN && CHAT_ID);
}

/** Send a Telegram message to the admin chat. HTML parse_mode supported —
 *  use <b>bold</b>, <code>mono</code>, etc. Returns true on confirmed
 *  delivery, false otherwise (never throws). */
export async function tg(text: string): Promise<boolean> {
  if (!TOKEN || !CHAT_ID) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.warn("[telegram] alerts disabled — TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set");
    }
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: CHAT_ID,
        text,
        parse_mode: "HTML",
        // Make sure the admin's phone actually buzzes — never deliver silently.
        disable_notification: false,
        disable_web_page_preview: true,
      }),
      // Short timeout — if Telegram is slow, don't hold up the user request.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      // Telegram replies with a JSON error (e.g. wrong chat_id, bot blocked,
      // HTML parse error). Surface it so the cause is visible in logs.
      const detail = await res.text().catch(() => "");
      console.warn(`[telegram] send failed: HTTP ${res.status} ${detail.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e: any) {
    console.warn(`[telegram] send error: ${e?.name === "TimeoutError" ? "timed out" : e?.message ?? e}`);
    return false;
  }
}
