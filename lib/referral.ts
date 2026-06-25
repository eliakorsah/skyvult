import { supabaseAdmin } from "./supabase";
import { withLock } from "./mutex";
import { RISK } from "./assets";

/** Fixed referrer payout when a referee makes a qualifying first deposit.
 *  Kept in code (not config) so it can't be changed without a code review. */
export const REFERRAL_BONUS = 30;

/** Rollover multiple: the bonus must be wagered REFERRAL_WAGER_MULTIPLIER× in
 *  real-money trades before it becomes withdrawable. 1 = trade ₵30, then the
 *  ₵30 unlocks. Stops a referrer from cashing the bonus straight out. */
export const REFERRAL_WAGER_MULTIPLIER = 1;

/** Called from every code path that confirms a real-money deposit (admin
 *  credit today, MoMo webhook tomorrow). Awards the referrer ₵30 ONCE, only
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
    let paid = false;
    await withLock(`wallet:${referrerId}`, async () => {
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: w } = await supabaseAdmin
          .from("wallets")
          .select("balance, bonus_locked, wagering_remaining")
          .eq("user_id", referrerId)
          .single();
        if (!w) return;
        const before = Number(w.balance);
        const after = before + REFERRAL_BONUS;
        // Credit the bonus, but lock it: it can't be withdrawn until the
        // referrer trades REFERRAL_BONUS × REFERRAL_WAGER_MULTIPLIER in real money.
        const { data: upd } = await supabaseAdmin
          .from("wallets")
          .update({
            balance:            after,
            bonus_locked:       Number(w.bonus_locked) + REFERRAL_BONUS,
            wagering_remaining: Number(w.wagering_remaining) + REFERRAL_BONUS * REFERRAL_WAGER_MULTIPLIER,
          })
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
          paid = true;
          return;
        }
      }
      console.error("[referral] payout failed after retries", { referrerId, refereeUserId });
    });

    // If the credit never landed (wallet missing, columns absent because the
    // wagering migration hasn't run, or 5 contended retries), roll the claim
    // back so the referee isn't permanently marked paid while the referrer got
    // nothing — the next qualifying deposit / admin approval can retry cleanly.
    if (!paid) {
      await supabaseAdmin
        .from("profiles")
        .update({ referral_bonus_paid: false })
        .eq("id", refereeUserId)
        .eq("referral_bonus_paid", true);
    }
  } catch (err: any) {
    console.error("[referral] maybePayReferralBonus error:", err?.message);
  }
}

/** Counts a real-money trade toward any outstanding referral wagering
 *  requirement. When the requirement is fully met, the locked bonus is
 *  released (bonus_locked → 0, i.e. becomes withdrawable).
 *
 *  Touches only the wagering columns — never `balance` — so it can run
 *  concurrently with settlement credits without lost updates. Uses
 *  optimistic concurrency keyed on `wagering_remaining` and retries.
 *  No-op when the user has nothing locked. Never throws. */
export async function progressWagering(userId: string, tradeAmount: number): Promise<void> {
  if (!isFinite(tradeAmount) || tradeAmount <= 0) return;
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: w } = await supabaseAdmin
        .from("wallets")
        .select("bonus_locked, wagering_remaining")
        .eq("user_id", userId)
        .single();
      if (!w) return;
      const remaining = Number(w.wagering_remaining);
      if (remaining <= 0) return; // nothing locked — fast exit
      const newRemaining = Math.max(0, remaining - tradeAmount);
      const newLocked = newRemaining === 0 ? 0 : Number(w.bonus_locked);
      const { data: upd } = await supabaseAdmin
        .from("wallets")
        .update({ wagering_remaining: newRemaining, bonus_locked: newLocked })
        .eq("user_id", userId)
        .eq("wagering_remaining", remaining)
        .select("user_id");
      if (upd && upd.length > 0) return;
    }
  } catch (err: any) {
    console.error("[referral] progressWagering error:", err?.message);
  }
}
