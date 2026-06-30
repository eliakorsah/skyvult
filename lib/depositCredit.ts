import { supabaseAdmin } from "./supabase";
import { withLock } from "./mutex";
import { maybePayReferralBonus } from "./referral";
import { tg } from "./telegram";

/** Shared, idempotent deposit-credit path used by the Paystack webhook and
 *  the status-route fallback. Credits the user's real wallet exactly once for
 *  a PENDING deposit row, writes the ledger transaction, marks the payment
 *  SUCCESS, and fires the referral-bonus check.
 *
 *  Idempotency: the payment row is atomically flipped PENDING→SUCCESS at the
 *  DB level BEFORE the wallet credit. Only the caller that wins that DB-level
 *  race proceeds — concurrent callers from different PM2 workers (webhook and
 *  status-poll arriving at the same instant) are safely serialised this way.
 *
 *  `pay` must include id, user_id, provider_reference.
 */
export async function creditDepositWallet(pay: any, cedis: number): Promise<void> {
  if (!isFinite(cedis) || cedis <= 0) return;

  // Atomically claim the payment. The WHERE status='PENDING' guard means only
  // one concurrent caller (across any number of PM2 workers) will get 1 row
  // back — all others get 0 and bail out immediately.
  const { data: claimed } = await supabaseAdmin
    .from("payments")
    .update({ status: "SUCCESS", resolved_at: new Date().toISOString() })
    .eq("id", pay.id)
    .eq("status", "PENDING")
    .select("id");
  if (!claimed || claimed.length === 0) return; // another path already resolved it

  // We own the credit — now apply it with optimistic-concurrency retry so
  // concurrent TRADE mutations don't race against us on the wallet row.
  await withLock(`wallet:${pay.user_id}`, async () => {
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
        await tg(`💰 <b>Deposit confirmed</b>\n₵${cedis.toFixed(2)} via ${pay.mobile_provider ?? "MoMo"}\n📱 ${pay.mobile_number ?? ""}\n🔖 <code>${pay.provider_reference}</code>`);
        await maybePayReferralBonus(pay.user_id, cedis);
        return;
      }
    }
    console.error("[depositCredit] wallet credit failed after retries — payment already marked SUCCESS, manual reconciliation needed", pay.provider_reference);
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
