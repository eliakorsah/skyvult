import { supabaseAdmin } from "./supabase";
import { withLock } from "./mutex";
import { maybePayReferralBonus } from "./referral";

/** Shared, idempotent deposit-credit path used by BOTH the Korapay webhook
 *  and the MTN finalize step. Credits the user's real wallet exactly once for
 *  a PENDING deposit row, writes the ledger transaction, marks the payment
 *  SUCCESS, and fires the referral-bonus check.
 *
 *  Idempotency: every mutation is gated on `status = 'PENDING'`, so a second
 *  call (webhook retry, double-poll) is a no-op. Safe to call from multiple
 *  places for the same reference.
 *
 *  `pay` is the row from `payments` (must include id, user_id, provider_reference).
 */
export async function creditDepositWallet(pay: any, cedis: number): Promise<void> {
  if (!isFinite(cedis) || cedis <= 0) return;
  if (pay.status !== "PENDING") return;

  await withLock(`wallet:${pay.user_id}`, async () => {
    // Optimistic-concurrency credit with retry — closes the race against the
    // trade API mutating this user's wallet at the same instant.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("balance")
        .eq("user_id", pay.user_id)
        .single();
      if (!wallet) return;
      const before = Number(wallet.balance);
      const after  = before + cedis;
      const { data: upd } = await supabaseAdmin
        .from("wallets")
        .update({ balance: after })
        .eq("user_id", pay.user_id)
        .eq("balance", before)
        .select("user_id");
      if (upd && upd.length > 0) {
        await supabaseAdmin.from("transactions").insert({
          user_id: pay.user_id,
          type:    "DEPOSIT",
          amount:  cedis,
          balance_before: before,
          balance_after:  after,
          reference: pay.provider_reference,
          is_demo: false,
        });
        // Mark resolved AFTER the credit lands, gated on PENDING for idempotency.
        await supabaseAdmin
          .from("payments")
          .update({ status: "SUCCESS", resolved_at: new Date().toISOString() })
          .eq("id", pay.id)
          .eq("status", "PENDING");
        await maybePayReferralBonus(pay.user_id, cedis);
        return;
      }
    }
    console.error("[depositCredit] credit failed after retries", pay.provider_reference);
  });
}

/** Mark a PENDING deposit FAILED (idempotent). */
export async function failDeposit(pay: any, reason: string): Promise<void> {
  if (pay.status !== "PENDING") return;
  await supabaseAdmin
    .from("payments")
    .update({
      status: "FAILED",
      failure_reason: reason.slice(0, 200),
      resolved_at: new Date().toISOString(),
    })
    .eq("id", pay.id)
    .eq("status", "PENDING");
}
