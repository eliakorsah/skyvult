import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { RISK } from "@/lib/assets";
import { normalizeGhanaPhone } from "@/lib/korapay";
import { requestToPay, isMtnConfigured } from "@/lib/mtnmomo";
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

    // Floor: covers MoMo transaction fees + keeps the platform from being
    // spammed with tiny deposits that lose money on fees alone.
    if (body.amount < RISK.MIN_DEPOSIT) {
      return fail(400, `Minimum deposit is GHS ${RISK.MIN_DEPOSIT}`);
    }

    // Phone normalisation: accept "+233...", "233...", "0..." formats and
    // collapse to a 10-digit local.
    const phone = normalizeGhanaPhone(body.phone);
    if (!phone) return fail(400, "Invalid Ghana mobile number");

    // Korapay (Telecel/AirtelTigo rail) is switched off until the merchant
    // account is configured for Mobile Money — MTN direct is the only live
    // rail for now.
    if (body.provider !== "MTN") {
      return fail(400, "Telecel and AirtelTigo deposits are temporarily unavailable. Please use MTN MoMo.");
    }
    if (!isMtnConfigured()) {
      return fail(503, "Deposits are temporarily unavailable. Please try again later.");
    }

    // 5 deposit attempts per 10 min per user. Stops a stuck user from
    // hammering MTN (each attempt sends a USSD push that costs them
    // attention even if they never enter the PIN).
    const rl = await checkLimit(req, "deposit", 5, 600, user.id);
    if (!rl.success) return fail(429, "Too many deposit attempts — try again in a moment");

    // Insert the PENDING audit row BEFORE calling MTN, so a successful
    // provider call with a network drop on our side still leaves a trail.
    // Status/callback/finalize all key off provider_reference.
    const mtnRef = crypto.randomUUID();
    const { error: insErr } = await supabaseAdmin.from("payments").insert({
      user_id: user.id,
      type:    "DEPOSIT",
      amount:  body.amount,
      status:  "PENDING",
      provider: "mtn",
      provider_reference: mtnRef,
      mobile_provider: body.provider,
      mobile_number:   phone,
    });
    if (insErr) {
      console.error("[deposit] failed to insert MTN payments row:", insErr.message);
      return fail(500, "Could not start deposit");
    }

    try {
      await requestToPay({
        amountGhs:  body.amount,
        phone,
        externalId: mtnRef,
        referenceId: mtnRef,
      });
      // MTN replied 202 — the user now approves the prompt on their phone.
      // Resolution happens via the status poll / MTN callback (verify-then-credit).
      return ok({
        reference: mtnRef,
        status:    "pending",
        message:   "Approve the payment prompt on your MTN phone.",
      });
    } catch (err: any) {
      await supabaseAdmin
        .from("payments")
        .update({
          status: "FAILED",
          failure_reason: err?.message?.slice(0, 200) ?? "MTN rejected the charge",
          resolved_at: new Date().toISOString(),
        })
        .eq("provider_reference", mtnRef);
      return fail(400, err?.message ?? "Could not start MoMo charge");
    }
  } catch (e) {
    return handleError(e);
  }
}
