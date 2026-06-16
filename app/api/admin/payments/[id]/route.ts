import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { withLock } from "@/lib/mutex";
import { creditDepositWallet } from "@/lib/depositCredit";

export const runtime = "nodejs";

const Schema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(200).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin(req);
    const body = Schema.parse(await req.json());
    const { id } = params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return fail(400, "Invalid ID");

    const { data: payment } = await supabaseAdmin
      .from("payments")
      .select("*")
      .eq("id", id)
      .single();

    if (!payment) return fail(404, "Payment not found");
    if (payment.status !== "PENDING") return fail(400, `Payment is already ${payment.status}`);

    // ── DEPOSIT ──────────────────────────────────────────────────────────
    if (payment.type === "DEPOSIT") {
      if (body.action === "approve") {
        // creditDepositWallet is idempotent — atomically claims the payment
        // and credits the wallet exactly once.
        await creditDepositWallet(payment, Number(payment.amount));
        return ok({ status: "approved" });
      }
      // reject: no wallet refund needed (nothing was debited for a deposit)
      await supabaseAdmin.from("payments").update({
        status:         "FAILED",
        failure_reason: (body.reason ?? "Rejected by admin").slice(0, 200),
        resolved_at:    new Date().toISOString(),
      }).eq("id", id).eq("status", "PENDING");
      return ok({ status: "rejected" });
    }

    // ── WITHDRAWAL ───────────────────────────────────────────────────────
    if (body.action === "reject") {
      // Refund the wallet, mark FAILED.
      await withLock(`wallet:${payment.user_id}`, async () => {
        for (let i = 0; i < 5; i++) {
          const { data: w } = await supabaseAdmin
            .from("wallets").select("balance").eq("user_id", payment.user_id).single();
          if (!w) return;
          const before = Number(w.balance);
          const after  = before + Number(payment.amount);
          const { data: upd } = await supabaseAdmin
            .from("wallets")
            .update({ balance: after })
            .eq("user_id", payment.user_id)
            .eq("balance", before)
            .select("user_id");
          if (upd?.length) {
            await supabaseAdmin.from("transactions").insert({
              user_id:        payment.user_id,
              type:           "WITHDRAWAL_REVERSAL",
              amount:         Number(payment.amount),
              balance_before: before,
              balance_after:  after,
              reference:      payment.provider_reference,
              is_demo:        false,
            });
            return;
          }
        }
      });
      await supabaseAdmin.from("payments").update({
        status:         "FAILED",
        failure_reason: body.reason ?? "Rejected by admin",
        resolved_at:    new Date().toISOString(),
      }).eq("id", id);
      return ok({ status: "rejected" });
    }

    // approve withdrawal: admin has manually sent the money via MoMo.
    await supabaseAdmin.from("payments").update({
      status:      "SUCCESS",
      resolved_at: new Date().toISOString(),
    }).eq("id", id);
    return ok({ status: "approved" });
  } catch (e) {
    return handleError(e);
  }
}
