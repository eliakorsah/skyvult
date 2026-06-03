import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin, requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { withLock } from "@/lib/mutex";
import { maybePayReferralBonus } from "@/lib/referral";

export const runtime = "nodejs";

const Schema = z.object({
  amount: z.number().positive().max(1_000_000),
  userId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const caller = await requireUser(req);
    const body   = Schema.parse(await req.json());

    if (caller.role !== "ADMIN") {
      return fail(403, "Deposits are temporarily unavailable. Payment integration coming soon.");
    }
    await requireAdmin(req);

    const targetId = body.userId ?? caller.id;

    // Wrap in per-user lock — prevents two simultaneous admin credits
    // from both reading the same balance and both adding to it (lost update).
    let after = 0;
    await withLock(`wallet:${targetId}`, async () => {
      const { data: wallet } = await supabaseAdmin
        .from("wallets").select("balance").eq("user_id", targetId).single();
      if (!wallet) return;

      const before = Number(wallet.balance);
      after = before + body.amount;

      const { error: updErr } = await supabaseAdmin
        .from("wallets")
        .update({ balance: after })
        .eq("user_id", targetId)
        .eq("balance", before); // optimistic concurrency
      if (updErr) { after = 0; return; }

      await supabaseAdmin.from("transactions").insert({
        user_id:        targetId,
        type:           "DEPOSIT",
        amount:         body.amount,
        balance_before: before,
        balance_after:  after,
        reference:      `admin-credit:${caller.id}`,
        is_demo:        false,
      });
    });

    if (!after) return fail(500, "Failed to credit wallet");

    await maybePayReferralBonus(targetId, body.amount);
    return ok({ balance: after });
  } catch (e) {
    return handleError(e);
  }
}
