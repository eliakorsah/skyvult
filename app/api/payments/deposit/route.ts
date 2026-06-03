import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { RISK } from "@/lib/assets";
import {
  chargeMobileMoney,
  normalizeGhanaPhone,
} from "@/lib/paystack";

export const runtime = "nodejs";

const Schema = z.object({
  amount: z.number().positive(),
  phone:  z.string().min(9).max(20),
  // UI-level provider label (we map to Paystack codes internally).
  provider: z.enum(["MTN", "TELECEL", "AIRTELTIGO"]),
});

/** Generates our internal reference for this deposit. Prefixed `dep_` so
 *  admins skimming the payments table can tell deposits from withdrawals
 *  at a glance, and includes enough entropy to be globally unique.
 *  Echoed back to Paystack and returned to our webhook for idempotency. */
function makeReference(userId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  // Strip dashes from the UUID to keep the reference under Paystack's 32-char
  // limit and stay alphanumeric only.
  return `dep_${userId.replace(/-/g, "").slice(0, 12)}_${rand}`;
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Schema.parse(await req.json());

    // Floor: covers MoMo transaction fees + keeps the platform from being
    // spammed with ₵1 deposits that lose money on fees alone.
    if (body.amount < RISK.MIN_DEPOSIT) {
      return fail(400, `Minimum deposit is GHS ${RISK.MIN_DEPOSIT}`);
    }

    // Phone normalisation: accept "+233...", "233...", "0..." formats and
    // collapse to a 10-digit local. Paystack accepts the local form.
    const phone = normalizeGhanaPhone(body.phone);
    if (!phone) return fail(400, "Invalid Ghana mobile number");

    // 5 deposit attempts per 10 min per user. Stops a stuck user from
    // hammering Paystack (each attempt sends a USSD push that costs them
    // attention even if they never enter the PIN).
    const rl = await checkLimit(req, "deposit", 5, 600, user.id);
    if (!rl.success) return fail(429, "Too many deposit attempts — try again in a moment");

    const reference = makeReference(user.id);

    // Insert the PENDING row BEFORE calling Paystack, so a successful
    // Paystack call with a network drop on our side still leaves an
    // audit trail. The webhook keys off provider_reference, which we
    // just generated.
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
      // Paystack returns pay_offline / send_otp / pending here. The actual
      // success/failure resolution lands on our webhook after the user
      // enters their PIN.
      return ok({
        reference,
        status:  charge.status,
        message: charge.message ?? "Check your phone and enter your MoMo PIN.",
      });
    } catch (err: any) {
      // Paystack rejected the charge synchronously (bad number, etc.).
      // Mark the row FAILED so the user can see what happened in their
      // payments history and the admin can debug.
      await supabaseAdmin
        .from("payments")
        .update({
          status: "FAILED",
          failure_reason: err?.message?.slice(0, 200) ?? "Provider rejected charge",
          resolved_at: new Date().toISOString(),
        })
        .eq("provider_reference", reference);
      return fail(400, err?.message ?? "Could not start MoMo charge");
    }
  } catch (e) {
    return handleError(e);
  }
}
