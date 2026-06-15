import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { verifyCharge } from "@/lib/paystack";

export const runtime = "nodejs";

/** Polled by the deposit UI while the user is entering their MoMo PIN.
 *  Primary path: look at our local `payments` row — the webhook updates
 *  it the moment Paystack confirms. Fallback: if the webhook hasn't
 *  arrived (slow tunnel, missed delivery), call Paystack's verify
 *  endpoint directly so a working flow doesn't stay stuck "PENDING"
 *  forever on the client.
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
      .select("status, type, amount, provider, failure_reason, resolved_at")
      .eq("provider_reference", ref)
      .eq("user_id", user.id)
      .single();
    if (!pay) return fail(404, "Payment not found");

    // Resolved already — return current state.
    if (pay.status !== "PENDING") return ok(pay);

    // Fallback: ask Paystack directly. If the charge succeeded, the
    // webhook is delayed/missed — let the webhook handle the actual
    // wallet credit (idempotent), but surface the right status to the UI
    // immediately so the user doesn't stare at "pending" forever.
    try {
      const verify = await verifyCharge(ref);
      const ps = String(verify?.data?.status ?? "").toLowerCase();
      if (ps === "success") return ok({ ...pay, status: "PENDING", hint: "Provider says success — finalising…" });
      if (ps === "failed")  return ok({ ...pay, status: "PENDING", hint: "Provider says failed — finalising…" });
      if (ps === "expired") return ok({ ...pay, status: "PENDING", hint: "Charge expired." });
    } catch {
      // verify failed — return whatever we have locally
    }

    return ok(pay);
  } catch (e) {
    return handleError(e);
  }
}
