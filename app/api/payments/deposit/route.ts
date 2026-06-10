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
} from "@/lib/korapay";
import { requestToPay, isMtnConfigured } from "@/lib/mtnmomo";
import crypto from "crypto";

export const runtime = "nodejs";

const Schema = z.object({
  amount: z.number().positive(),
  phone:  z.string().min(9).max(20),
  // UI-level provider label (we map to Korapay operator slugs internally).
  provider: z.enum(["MTN", "TELECEL", "AIRTELTIGO"]),
});

/** Generates our internal reference for this deposit. Prefixed `dep_` so
 *  admins skimming the payments table can tell deposits from withdrawals
 *  at a glance, and includes enough entropy to be globally unique.
 *  Echoed back to Korapay and returned to our webhook for idempotency. */
function makeReference(userId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  // Strip dashes from the UUID to keep the reference short and stay
  // alphanumeric (underscore) only.
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
    // collapse to a 10-digit local. Korapay accepts the local form.
    const phone = normalizeGhanaPhone(body.phone);
    if (!phone) return fail(400, "Invalid Ghana mobile number");

    // 5 deposit attempts per 10 min per user. Stops a stuck user from
    // hammering Korapay (each attempt sends a USSD push that costs them
    // attention even if they never enter the PIN).
    const rl = await checkLimit(req, "deposit", 5, 600, user.id);
    if (!rl.success) return fail(429, "Too many deposit attempts — try again in a moment");

    // Helper: insert the PENDING audit row BEFORE calling any provider, so a
    // successful provider call with a network drop on our side still leaves a
    // trail. Status/webhook/finalize all key off provider_reference.
    async function insertPending(provider: "korapay" | "mtn", reference: string) {
      const { error } = await supabaseAdmin.from("payments").insert({
        user_id: user.id,
        type:    "DEPOSIT",
        amount:  body.amount,
        status:  "PENDING",
        provider,
        provider_reference: reference,
        mobile_provider: body.provider,
        mobile_number:   phone,
      });
      return error;
    }

    // ── MTN numbers → MTN MoMo direct (primary). Korapay is the fallback if
    //    MTN errors synchronously (token/charge rejection). Telecel/AirtelTigo
    //    skip straight to Korapay below. ──────────────────────────────────────
    if (body.provider === "MTN" && isMtnConfigured()) {
      const mtnRef = crypto.randomUUID();
      const insErr = await insertPending("mtn", mtnRef);
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
        // MTN unavailable / rejected → mark this attempt FAILED and fall
        // through to Korapay so the deposit still has a chance to complete.
        console.warn("[deposit] MTN rail failed, falling back to Korapay:", err?.message);
        await supabaseAdmin
          .from("payments")
          .update({
            status: "FAILED",
            failure_reason: `MTN: ${err?.message?.slice(0, 180) ?? "unavailable"} (fell back to Korapay)`,
            resolved_at: new Date().toISOString(),
          })
          .eq("provider_reference", mtnRef);
        // fall through ↓
      }
    }

    // ── Korapay rail (Telecel/AirtelTigo, or MTN fallback). ─────────────────
    const reference = makeReference(user.id);
    const insErr = await insertPending("korapay", reference);
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
        name:      user.name,
      });
      // Korapay returns processing / pending here. The actual success/failure
      // resolution lands on our webhook after the user authorises.
      return ok({
        reference,
        status:  charge.status,
        message: charge.message ?? "Check your phone and approve the MoMo payment.",
      });
    } catch (err: any) {
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
