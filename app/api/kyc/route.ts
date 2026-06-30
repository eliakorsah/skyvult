import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { tg } from "@/lib/telegram";
import { normalizeGhanaPhone, guessProviderFromPhone } from "@/lib/korapay";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("kyc_status")
      .eq("id", user.id)
      .single();

    const { data: submission } = await supabaseAdmin
      .from("kyc_submissions")
      .select("id, status, full_name, id_type, id_number, date_of_birth, rejection_reason, submitted_at")
      .eq("user_id", user.id)
      .in("status", ["PENDING", "APPROVED", "REJECTED"])
      .order("submitted_at", { ascending: false })
      .limit(1)
      .single();

    return ok({
      kycStatus: profile?.kyc_status ?? "NONE",
      submission: submission
        ? {
            id:              submission.id,
            status:          submission.status,
            fullName:        submission.full_name,
            idType:          submission.id_type,
            idNumber:        submission.id_number,
            dateOfBirth:     submission.date_of_birth,
            rejectionReason: submission.rejection_reason,
            submittedAt:     submission.submitted_at,
          }
        : null,
    });
  } catch (e) {
    return handleError(e);
  }
}

const SubmitSchema = z.object({
  accountName:  z.string().min(2).max(120),
  mobileNumber: z.string().min(9).max(20),
  frontPath:    z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = SubmitSchema.parse(await req.json());

    const phone = normalizeGhanaPhone(body.mobileNumber);
    if (!phone) return fail(400, "Please enter a valid Ghana phone number.");
    const provider = guessProviderFromPhone(phone);
    if (!provider) return fail(400, "We couldn't recognise that number's network. Please check it and try again.");

    const { data: existing } = await supabaseAdmin
      .from("kyc_submissions")
      .select("id, status")
      .eq("user_id", user.id)
      .in("status", ["PENDING", "APPROVED"])
      .maybeSingle();

    if (existing?.status === "APPROVED") return fail(400, "Your identity is already verified.");
    if (existing?.status === "PENDING")  return fail(400, "Your submission is already under review.");

    const accountName = body.accountName.trim();

    const { error } = await supabaseAdmin.from("kyc_submissions").insert({
      user_id:         user.id,
      full_name:       accountName,
      id_type:         "GHANA_CARD",
      front_path:      body.frontPath,
      mobile_number:   phone,
      mobile_provider: provider,
      mobile_name:     accountName,
    });

    if (error) {
      console.error("[kyc] insert error:", error.message);
      return fail(500, "Could not save your submission.");
    }

    await supabaseAdmin
      .from("profiles")
      .update({ kyc_status: "PENDING" })
      .eq("id", user.id);

    await tg(`🪪 <b>KYC submitted</b>\n👤 ${user.name} (${user.email})\n📱 ${phone}`);
    return ok({ status: "PENDING" });
  } catch (e) {
    return handleError(e);
  }
}
