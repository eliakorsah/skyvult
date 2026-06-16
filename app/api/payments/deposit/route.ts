import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { RISK, DEPOSITS_ENABLED } from "@/lib/assets";
import { submitPayment, checkoutUrl, isExpressPayConfigured } from "@/lib/expresspay";
import crypto from "crypto";

export const runtime = "nodejs";

const Schema = z.object({
  amount: z.number().finite().positive(),
});

const APP_URL = process.env.EXPRESSPAY_APP_URL || "https://skyvult.com";

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Schema.parse(await req.json());

    if (!DEPOSITS_ENABLED) {
      return fail(503, "Deposits are temporarily unavailable. Please check back soon.");
    }
    if (!isExpressPayConfigured()) {
      return fail(503, "Deposits are temporarily unavailable. Please try again later.");
    }

    if (body.amount < RISK.MIN_DEPOSIT) {
      return fail(400, `Minimum deposit is GHS ${RISK.MIN_DEPOSIT}`);
    }

    const rl = await checkLimit(req, "deposit", 5, 600, user.id);
    if (!rl.success) return fail(429, "Too many deposit attempts — try again in a moment");

    const orderId = crypto.randomUUID();

    const { error: insErr } = await supabaseAdmin.from("payments").insert({
      user_id:            user.id,
      type:               "DEPOSIT",
      amount:             body.amount,
      status:             "PENDING",
      provider:           "expresspay",
      provider_reference: orderId,
    });
    if (insErr) {
      console.error("[deposit] failed to insert payments row:", insErr.message);
      return fail(500, "Could not start deposit");
    }

    const nameParts = (user.name || "").trim().split(/\s+/);
    const firstname = nameParts[0] || "Customer";
    const lastname  = nameParts.slice(1).join(" ") || firstname;

    try {
      const submit = await submitPayment({
        firstname,
        lastname,
        email:       user.email,
        amount:      body.amount,
        orderId,
        redirectUrl: `${APP_URL}/api/payments/expresspay-callback`,
        postUrl:     `${APP_URL}/api/payments/expresspay-posturl`,
      });

      if (submit.status !== 1 || !submit.token) {
        await supabaseAdmin.from("payments").update({
          status:         "FAILED",
          failure_reason: (submit.message || "Payment provider rejected the request").slice(0, 200),
          resolved_at:    new Date().toISOString(),
        }).eq("provider_reference", orderId);
        return fail(400, submit.message || "Could not start payment — please try again");
      }

      return ok({ checkoutUrl: checkoutUrl(submit.token), reference: orderId });
    } catch (err: any) {
      await supabaseAdmin.from("payments").update({
        status:         "FAILED",
        failure_reason: (err?.message || "ExpressPay error").slice(0, 200),
        resolved_at:    new Date().toISOString(),
      }).eq("provider_reference", orderId);
      return fail(400, err?.message ?? "Could not start payment");
    }
  } catch (e) {
    return handleError(e);
  }
}
