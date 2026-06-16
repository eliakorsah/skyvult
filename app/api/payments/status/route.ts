import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { verifyCharge } from "@/lib/paystack";
import { creditDepositWallet, failDeposit } from "@/lib/depositCredit";

export const runtime = "nodejs";

/** Polled by the deposit UI while the user is entering their MoMo PIN.
 *  Primary path: look at our local `payments` row — the webhook updates
 *  it the moment Paystack confirms. Fallback: if the webhook hasn't
 *  arrived (slow tunnel, missed delivery, misconfigured webhook URL), call
 *  Paystack's verify endpoint directly and resolve the payment ourselves —
 *  same idempotent credit/fail path the webhook uses, so whichever arrives
 *  first wins and the second is a no-op.
 *
 *  Scoped to the caller's own payments so you can't probe someone else's
 *  references. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const ref = new URL(req.url).searchParams.get("reference");
    if (!ref) return fail(400, "Missing reference");

    const { data: pay } = await supabaseAdmin
      .from("payments")
      .select("id, user_id, status, type, amount, provider, provider_reference, failure_reason, resolved_at")
      .eq("provider_reference", ref)
      .eq("user_id", user.id)
      .single();
    if (!pay) return fail(404, "Payment not found");

    // Resolved already — return current state.
    if (pay.status !== "PENDING") return ok(pay);

    // Fallback: ask Paystack directly and resolve the payment ourselves if
    // the webhook hasn't done so yet. Only applies to Paystack payments —
    // ExpressPay payments are resolved via their callback/posturl routes.
    if (pay.provider !== "paystack") return ok(pay);

    try {
      const verify = await verifyCharge(ref);
      const ps = String(verify?.data?.status ?? "").toLowerCase();

      if (ps === "success") {
        const cedis = verify?.data?.amount != null ? Number(verify.data.amount) / 100 : Number(pay.amount);
        await creditDepositWallet(pay, cedis);
        return ok({ ...pay, status: "SUCCESS", resolved_at: new Date().toISOString() });
      }
      if (ps === "failed" || ps === "abandoned") {
        const reason = verify?.data?.gateway_response || "Payment was not completed";
        await failDeposit(pay, reason);
        return ok({ ...pay, status: "FAILED", failure_reason: reason, resolved_at: new Date().toISOString() });
      }
      if (ps === "ongoing" || ps === "pending" || ps === "queued") {
        return ok({ ...pay, hint: "Waiting for you to approve the payment on your phone…" });
      }
    } catch {
      // verify failed — return whatever we have locally
    }

    return ok(pay);
  } catch (e) {
    return handleError(e);
  }
}
