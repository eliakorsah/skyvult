import { supabaseAdmin } from "./supabase";

/** Payment details an admin configures from the admin panel. These drive the
 *  manual-deposit flow: users are shown the payment link, pay, and the admin
 *  confirms the payment before any wallet is credited. */
export type PaymentSettings = {
  paymentLink: string;
  depositInstructions: string;
};

const KEYS = {
  paymentLink:         "payment_link",
  depositInstructions: "deposit_instructions",
} as const;

const DEFAULT_INSTRUCTIONS =
  "Pay using the link above, then keep your reference. Your balance is credited once we confirm receipt.";

/** Reads the configured payment settings. Never throws — returns sensible
 *  defaults on error. */
export async function getPaymentSettings(): Promise<PaymentSettings> {
  try {
    const { data } = await supabaseAdmin
      .from("platform_settings")
      .select("key, value")
      .in("key", Object.values(KEYS));

    const map = new Map((data ?? []).map((r: any) => [r.key, r.value as string]));
    return {
      paymentLink:         (map.get(KEYS.paymentLink) ?? "").trim(),
      depositInstructions: (map.get(KEYS.depositInstructions) || DEFAULT_INSTRUCTIONS).trim(),
    };
  } catch {
    return { paymentLink: "", depositInstructions: DEFAULT_INSTRUCTIONS };
  }
}

/** Upserts the provided payment settings. Only the keys present in `patch` are
 *  written. Returns the full, freshly-read settings. */
export async function updatePaymentSettings(patch: Partial<PaymentSettings>): Promise<PaymentSettings> {
  const rows: { key: string; value: string; updated_at: string }[] = [];
  const now = new Date().toISOString();
  if (patch.paymentLink !== undefined)
    rows.push({ key: KEYS.paymentLink, value: patch.paymentLink.trim(), updated_at: now });
  if (patch.depositInstructions !== undefined)
    rows.push({ key: KEYS.depositInstructions, value: patch.depositInstructions.trim(), updated_at: now });

  if (rows.length) {
    await supabaseAdmin.from("platform_settings").upsert(rows, { onConflict: "key" });
  }
  return getPaymentSettings();
}
