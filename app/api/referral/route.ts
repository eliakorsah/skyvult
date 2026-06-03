import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

/** Returns the caller's referral stats:
 *    - code            : their share code
 *    - referredCount   : how many users signed up using this code
 *    - paidCount       : how many of those have triggered the bonus payout
 *                        (i.e. made their first qualifying deposit)
 *    - totalBonus      : ₵ credited to this user via REFERRAL_BONUS txns
 *
 *  The UI uses this to render "Your code: SKY-XYZ123 · 3 referrals · ₵30 earned".
 */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const rl = await checkLimit(req, "referral", 30, 60, user.id);
    if (!rl.success) return fail(429, "Too many requests");

    const [
      { data: me },
      { count: referredCount },
      { count: paidCount },
      { data: bonusTxns },
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("referral_code").eq("id", user.id).single(),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("referred_by", user.id),
      supabaseAdmin
        .from("profiles")
        .select("id", { count: "exact", head: true })
        .eq("referred_by", user.id)
        .eq("referral_bonus_paid", true),
      supabaseAdmin
        .from("transactions")
        .select("amount")
        .eq("user_id", user.id)
        .eq("type", "REFERRAL_BONUS"),
    ]);

    const totalBonus = (bonusTxns ?? []).reduce((s, r) => s + Number((r as any).amount), 0);

    return ok(
      {
        code: me?.referral_code ?? null,
        referredCount: referredCount ?? 0,
        paidCount: paidCount ?? 0,
        totalBonus,
      },
      // intentionally no Cache-Control: this changes whenever a new
      // referee signs up or deposits; api.ts already passes no-store.
    );
  } catch (e) {
    return handleError(e);
  }
}
