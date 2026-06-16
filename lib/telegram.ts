/** Fire-and-forget Telegram alert helper. Never throws — a failed
 *  notification must never block the operation that triggered it. */

const TOKEN   = process.env.TELEGRAM_BOT_TOKEN  || "";
const CHAT_ID = process.env.TELEGRAM_CHAT_ID    || "";

export function isTelegramConfigured(): boolean {
  return Boolean(TOKEN && CHAT_ID);
}

/** Send a Telegram message to the admin chat. HTML parse_mode supported —
 *  use <b>bold</b>, <code>mono</code>, etc. */
export async function tg(text: string): Promise<void> {
  if (!TOKEN || !CHAT_ID) return;
  try {
    await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: "HTML" }),
      // Short timeout — if Telegram is slow, don't hold up the user request.
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Silently swallow — alerts are best-effort.
  }
}
