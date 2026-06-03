import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";

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
      submission: submission ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}

const SubmitSchema = z.object({
  fullName:       z.string().min(2).max(120),
  dateOfBirth:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD format"),
  idType:         z.enum(["GHANA_CARD", "PASSPORT", "DRIVERS_LICENSE"]),
  idNumber:       z.string().min(4).max(50),
  mobileNumber:   z.string().min(9).max(20),
  mobileProvider: z.enum(["MTN", "TELECEL", "AIRTELTIGO"]),
  frontPath:      z.string().min(1),
  backPath:       z.string().optional(),
  selfiePath:     z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = SubmitSchema.parse(await req.json());

    // Block re-submission if already PENDING or APPROVED
    const { data: existing } = await supabaseAdmin
      .from("kyc_submissions")
      .select("id, status")
      .eq("user_id", user.id)
      .in("status", ["PENDING", "APPROVED"])
      .maybeSingle();

    if (existing?.status === "APPROVED") return fail(400, "Your identity is already verified.");
    if (existing?.status === "PENDING")  return fail(400, "Your submission is already under review.");

    const { error } = await supabaseAdmin.from("kyc_submissions").insert({
      user_id:         user.id,
      full_name:       body.fullName,
      date_of_birth:   body.dateOfBirth,
      id_type:         body.idType,
      id_number:       body.idNumber,
      mobile_number:   body.mobileNumber,
      mobile_provider: body.mobileProvider,
      front_path:      body.frontPath,
      back_path:       body.backPath ?? null,
      selfie_path:     body.selfiePath ?? null,
    });

    if (error) {
      console.error("[kyc] insert error:", error.message);
      return fail(500, "Could not save your submission.");
    }

    await supabaseAdmin
      .from("profiles")
      .update({ kyc_status: "PENDING" })
      .eq("id", user.id);

    return ok({ status: "PENDING" });
  } catch (e) {
    return handleError(e);
  }
}
