import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { RISK, DEPOSITS_ENABLED } from "@/lib/assets";
import { normalizeGhanaPhone } from "@/lib/korapay";
import { chargeMobileMoney, isPaystackConfigured } from "@/lib/paystack";
import crypto from "crypto";

export const runtime = "nodejs";

const Schema = z.object({
  amount: z.number().finite().positive(),
  phone:  z.string().min(9).max(20),
  provider: z.enum(["MTN", "TELECEL", "AIRTELTIGO"]),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Schema.parse(await req.json());

    if (!DEPOSITS_ENABLED) {
      return fail(503, "Deposits are temporarily unavailable while we finish setting up our payment provider. Please check back soon.");
    }
    if (!isPaystackConfigured()) {
      return fail(503, "Deposits are temporarily unavailable. Please try again later.");
    }

    // Floor: covers MoMo transaction fees + keeps the platform from being
    // spammed with tiny deposits that lose money on fees alone.
    if (body.amount < RISK.MIN_DEPOSIT) {
      return fail(400, `Minimum deposit is GHS ${RISK.MIN_DEPOSIT}`);
    }

    // Phone normalisation: accept "+233...", "233...", "0..." formats and
    // collapse to a 10-digit local.
    const phone = normalizeGhanaPhone(body.phone);
    if (!phone) return fail(400, "Invalid Ghana mobile number");

    // 5 deposit attempts per 10 min per user. Stops a stuck user from
    // hammering the provider (each attempt sends a USSD push that costs
    // them attention even if they never enter the PIN).
    const rl = await checkLimit(req, "deposit", 5, 600, user.id);
    if (!rl.success) return fail(429, "Too many deposit attempts — try again in a moment");

    // Insert the PENDING audit row BEFORE calling Paystack, so a successful
    // provider call with a network drop on our side still leaves a trail.
    // Status/webhook resolution both key off provider_reference.
    const reference = crypto.randomUUID();
    const { error: insErr } = await supabaseAdmin.from("payments").insert({
      user_id: user.id,
      type:    "DEPOSIT",
      amount:  body.amount,
      status:  "PENDING",
      provider: "paystack",
      provider_reference: reference,
      mobile_provider: body.provider,
      mobile_number:   phone,
    });
    if (insErr) {
      console.error("[deposit] failed to insert payments row:", insErr.message);
      return fail(500, "Could not start deposit");
    }

    try {
      const charge = await chargeMobileMoney({
        amountGhs: body.amount,
        email:     user.email,
        phone,
        provider:  body.provider,
        reference,
      });

      // Some failures come back as a normal (status: true) /charge response
      // with data.status === "failed" rather than an HTTP error — catch
      // those here so the row isn't left PENDING forever.
      if (charge.status === "failed") {
        await supabaseAdmin
          .from("payments")
          .update({
            status: "FAILED",
            failure_reason: (charge.displayText || "Charge failed").slice(0, 200),
            resolved_at: new Date().toISOString(),
          })
          .eq("provider_reference", reference);
        return fail(400, charge.displayText || "Could not start MoMo charge");
      }

      // pay_offline = USSD prompt sent, nothing more to do; send_otp = the
      // network needs a one-time code, which the UI collects via
      // /api/payments/deposit/otp.
      return ok({
        reference,
        status:  charge.status === "send_otp" ? "send_otp" : "pending",
        message: charge.displayText || "Approve the payment prompt on your phone.",
      });
    } catch (err: any) {
      await supabaseAdmin
        .from("payments")
        .update({
          status: "FAILED",
          failure_reason: err?.message?.slice(0, 200) ?? "Paystack rejected the charge",
          resolved_at: new Date().toISOString(),
        })
        .eq("provider_reference", reference);
      return fail(400, err?.message ?? "Could not start MoMo charge");
    }
  } catch (e) {
    return handleError(e);
  }
}
