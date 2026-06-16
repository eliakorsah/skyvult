import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { RISK, DEPOSITS_ENABLED } from "@/lib/assets";
import { normalizeGhanaPhone } from "@/lib/korapay";
import { tg } from "@/lib/telegram";
import crypto from "crypto";

export const runtime = "nodejs";

const Schema = z.object({
  amount: z.number().finite().positive(),
  phone:  z.string().min(9).max(20),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Schema.parse(await req.json());

    if (!DEPOSITS_ENABLED) {
      return fail(503, "Deposits are temporarily unavailable. Please check back soon.");
    }

    if (body.amount < RISK.MIN_DEPOSIT) {
      return fail(400, `Minimum deposit is GHS ${RISK.MIN_DEPOSIT}`);
    }

    const phone = normalizeGhanaPhone(body.phone);
    if (!phone) return fail(400, "Invalid Ghana mobile number");

    const rl = await checkLimit(req, "deposit", 5, 600, user.id);
    if (!rl.success) return fail(429, "Too many deposit attempts — try again in a moment");

    const reference      = `DEP-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const merchantNumber = process.env.MERCHANT_MOMO_NUMBER || "";

    const { error: insErr } = await supabaseAdmin.from("payments").insert({
      user_id:            user.id,
      type:               "DEPOSIT",
      amount:             body.amount,
      status:             "PENDING",
      provider:           "manual",
      provider_reference: reference,
      mobile_number:      phone,
    });
    if (insErr) {
      console.error("[deposit] insert error:", insErr.message);
      return fail(500, "Could not start deposit");
    }

    tg(`💰 <b>Deposit request</b>\n👤 ${user.name} (${user.email})\n💵 ₵${body.amount.toFixed(2)}\n📱 Sending from: ${phone}\n🔖 Ref: <code>${reference}</code>\n➡️ Expecting on: ${merchantNumber}`);

    return ok({ reference, merchantNumber, amount: body.amount });
  } catch (e) {
    return handleError(e);
  }
}
