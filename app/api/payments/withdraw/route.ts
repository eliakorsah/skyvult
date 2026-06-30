import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { RISK } from "@/lib/assets";
import { withLock } from "@/lib/mutex";
import { tg } from "@/lib/telegram";

export const runtime = "nodejs";

const Schema = z.object({
  amount: z.number().finite().positive(),
});

function makeReference(userId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `wd_${userId.replace(/-/g, "").slice(0, 12)}_${rand}`;
}

/** Best-effort read of the locked referral bonus. Returns 0 if the wagering
 *  columns don't exist yet (migration 011 not applied) so withdrawals keep
 *  working — the lock just isn't enforced until the migration is run. */
async function readBonusLocked(userId: string): Promise<number> {
  const { data } = await supabaseAdmin
    .from("wallets")
    .select("bonus_locked")
    .eq("user_id", userId)
    .single();
  return data ? Number((data as any).bonus_locked ?? 0) : 0;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Schema.parse(await req.json());

    if (body.amount < RISK.MIN_DEPOSIT) {
      return fail(400, `Minimum withdrawal is GHS ${RISK.MIN_DEPOSIT}`);
    }

    // KYC required — also pulls the verified mobile number registered to the user's ID
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("kyc_status, verified_mobile_number, verified_mobile_provider")
      .eq("id", user.id)
      .single();

    if (!profile || profile.kyc_status !== "APPROVED") {
      return fail(403, "Identity verification required before withdrawing. Please complete KYC in the Wallet page.");
    }
    if (!profile.verified_mobile_number || !profile.verified_mobile_provider) {
      return fail(403, "No verified mobile number on file. Please complete KYC with your MoMo number.");
    }

    // 3 withdrawal attempts per 30 min per user.
    const rl = await checkLimit(req, "withdraw", 3, 1800, user.id);
    if (!rl.success) return fail(429, "Too many withdrawal attempts — try again later");

    // Pre-check balance before acquiring the lock (fast path). The locked
    // referral bonus is NOT withdrawable until its wagering requirement is met.
    const { data: wallet } = await supabaseAdmin
      .from("wallets")
      .select("balance")
      .eq("user_id", user.id)
      .single();
    if (!wallet) return fail(500, "Wallet not found");
    const locked = await readBonusLocked(user.id);
    if (Number(wallet.balance) - locked < body.amount) {
      return fail(400, locked > 0
        ? `Insufficient withdrawable balance — ₵${locked.toFixed(2)} of referral bonus is locked until you meet its wagering requirement.`
        : "Insufficient balance");
    }

    const reference = makeReference(user.id);

    // Insert the PENDING row for audit trail BEFORE touching the wallet.
    const { error: insErr } = await supabaseAdmin.from("payments").insert({
      user_id:            user.id,
      type:               "WITHDRAWAL",
      amount:             body.amount,
      status:             "PENDING",
      provider:           "korapay",
      provider_reference: reference,
      mobile_provider:    profile.verified_mobile_provider,
      mobile_number:      profile.verified_mobile_number,
    });
    if (insErr) {
      console.error("[withdraw] failed to insert payments row:", insErr.message);
      return fail(500, "Could not start withdrawal");
    }

    let debitOk = false;
    await withLock(`wallet:${user.id}`, async () => {
      // Re-read the lock inside the mutex so a referral bonus credited between
      // the pre-check and here can't be withdrawn before its wagering is met.
      const lockedNow = await readBonusLocked(user.id);
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: w } = await supabaseAdmin
          .from("wallets")
          .select("balance")
          .eq("user_id", user.id)
          .single();
        if (!w) return;
        const before = Number(w.balance);
        if (before - lockedNow < body.amount) return;
        const after = before - body.amount;
        const { data: upd } = await supabaseAdmin
          .from("wallets")
          .update({ balance: after })
          .eq("user_id", user.id)
          .eq("balance", before)
          .select("user_id");
        if (upd && upd.length > 0) {
          await supabaseAdmin.from("transactions").insert({
            user_id:        user.id,
            type:           "WITHDRAWAL",
            amount:         body.amount,
            balance_before: before,
            balance_after:  after,
            reference,
            is_demo:        false,
          });
          debitOk = true;
          return;
        }
      }
    });

    if (!debitOk) {
      await supabaseAdmin
        .from("payments")
        .update({ status: "FAILED", failure_reason: "Insufficient balance", resolved_at: new Date().toISOString() })
        .eq("provider_reference", reference);
      return fail(400, "Insufficient balance");
    }

    await tg(`💸 <b>Withdrawal request</b>\n👤 ${user.name} (${user.email})\n💵 ₵${body.amount} → ${profile.verified_mobile_number} (${profile.verified_mobile_provider})\n🔖 <code>${reference}</code>`);
    return ok({
      reference,
      status:  "pending",
      message: `Withdrawal of ₵${body.amount} to ${profile.verified_mobile_number} submitted. Funds will be sent after admin review.`,
    });
  } catch (e) {
    return handleError(e);
  }
}
