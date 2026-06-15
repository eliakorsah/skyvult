import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { submitOtp } from "@/lib/paystack";

export const runtime = "nodejs";

const Schema = z.object({
  reference: z.string().min(1),
  otp: z.string().min(4).max(10),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Schema.parse(await req.json());

    // 5 OTP attempts per 10 min per user — stops PIN-brute-forcing a charge.
    const rl = await checkLimit(req, "deposit-otp", 5, 600, user.id);
    if (!rl.success) return fail(429, "Too many attempts — try again in a moment");

    const { data: pay } = await supabaseAdmin
      .from("payments")
      .select("status, provider")
      .eq("provider_reference", body.reference)
      .eq("user_id", user.id)
      .single();
    if (!pay) return fail(404, "Payment not found");
    if (pay.provider !== "paystack") return fail(400, "Invalid payment");
    if (pay.status !== "PENDING") return fail(400, "This deposit is no longer pending");

    try {
      const result = await submitOtp(body.otp, body.reference);
      return ok({
        status:  result.status,
        message: result.displayText || "Confirming your payment…",
      });
    } catch (err: any) {
      return fail(400, err?.message ?? "Incorrect code — please try again");
    }
  } catch (e) {
    return handleError(e);
  }
}
