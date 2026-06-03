import { supabaseAdmin } from "./supabase";
import { withLock } from "./mutex";
import { RISK } from "./assets";

/** Fixed referrer payout when a referee makes a qualifying first deposit.
 *  Kept in code (not config) so it can't be changed without a code review. */
export const REFERRAL_BONUS = 10;

/** Called from every code path that confirms a real-money deposit (admin
 *  credit today, MoMo webhook tomorrow). Awards the referrer ₵10 ONCE, only
 *  if every gate passes:
 *    1. Deposit amount ≥ MIN_DEPOSIT (₵80) — kept in sync with the rest of
 *       the platform so a ₵1 self-deposit can't farm bonuses.
 *    2. The depositor has a referred_by set.
 *    3. The bonus hasn't already been paid for this depositor.
 *    4. The depositor is not the referrer (defensive — should never happen).
 *
 *  Idempotent and lock-protected: safe to call multiple times from racy
 *  payment webhooks. Failures are logged but do NOT propagate — the deposit
 *  itself succeeds even if the referral payout fails.
 */
export async function maybePayReferralBonus(refereeUserId: string, depositAmount: number): Promise<void> {
  try {
    if (depositAmount < RISK.MIN_DEPOSIT) return;

    const { data: refereeProfile } = await supabaseAdmin
      .from("profiles")
      .select("id, referred_by, referral_bonus_paid")
      .eq("id", refereeUserId)
      .single();
    if (!refereeProfile) return;
    if (!refereeProfile.referred_by) return;
    if (refereeProfile.referral_bonus_paid) return;
    if (refereeProfile.referred_by === refereeUserId) return;

    const referrerId = refereeProfile.referred_by as string;

    // Optimistic flag-flip first — if multiple deposits race, only the call
    // that wins this update proceeds with the credit. Subsequent racers see
    // bonus_paid = true on re-read above.
    const { data: claim } = await supabaseAdmin
      .from("profiles")
      .update({ referral_bonus_paid: true })
      .eq("id", refereeUserId)
      .eq("referral_bonus_paid", false)
      .select("id");
    if (!claim || claim.length === 0) return;

    // Wallet credit + transaction log, per-user serialized via the same
    // mutex the settlement worker uses.
    await withLock(`wallet:${referrerId}`, async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: w } = await supabaseAdmin
          .from("wallets")
          .select("balance")
          .eq("user_id", referrerId)
          .single();
        if (!w) return;
        const before = Number(w.balance);
        const after = before + REFERRAL_BONUS;
        const { data: upd } = await supabaseAdmin
          .from("wallets")
          .update({ balance: after })
          .eq("user_id", referrerId)
          .eq("balance", before)
          .select("user_id");
        if (upd && upd.length > 0) {
          await supabaseAdmin.from("transactions").insert({
            user_id: referrerId,
            type: "REFERRAL_BONUS",
            amount: REFERRAL_BONUS,
            balance_before: before,
            balance_after: after,
            reference: refereeUserId,
            is_demo: false,
          });
          return;
        }
      }
      console.error("[referral] payout failed after retries", { referrerId, refereeUserId });
    });
  } catch (err: any) {
    console.error("[referral] maybePayReferralBonus error:", err?.message);
  }
}
