import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";

export const runtime = "nodejs";

const BUCKET = "kyc-docs";
const SIGNED_URL_TTL = 3600; // 1 hour

async function signedViewUrl(path: string | null): Promise<string | null> {
  if (!path) return null;
  const { data } = await supabaseAdmin.storage
    .from(BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL);
  return data?.signedUrl ?? null;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const url = new URL(req.url);
    const raw    = url.searchParams.get("status") ?? "PENDING";
    const filter = ["PENDING", "APPROVED", "REJECTED"].includes(raw) ? raw : "PENDING";

    const { data: rows } = await supabaseAdmin
      .from("kyc_submissions")
      .select("id, status, user_id, full_name, date_of_birth, id_type, id_number, front_path, back_path, selfie_path, rejection_reason, submitted_at, resolved_at")
      .eq("status", filter)
      .order("submitted_at", { ascending: true })
      .limit(50);

    if (!rows?.length) return ok({ submissions: [] });

    // Fetch user profiles separately to avoid FK name guessing
    const userIds = [...new Set(rows.map((r: any) => r.user_id))];
    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, name, email")
      .in("id", userIds);
    const profileMap = Object.fromEntries((profiles ?? []).map((p: any) => [p.id, p]));

    // Attach short-lived signed view URLs for each document
    const submissions = await Promise.all(
      (rows ?? []).map(async (r: any) => {
        const profile = profileMap[r.user_id];
        return {
          id:              r.id,
          status:          r.status,
          fullName:        r.full_name,
          dateOfBirth:     r.date_of_birth,
          idType:          r.id_type,
          idNumber:        r.id_number,
          rejectionReason: r.rejection_reason,
          submittedAt:     r.submitted_at,
          resolvedAt:      r.resolved_at,
          user: profile
            ? { id: profile.id, name: profile.name, email: profile.email }
            : null,
          frontUrl:  await signedViewUrl(r.front_path),
          backUrl:   await signedViewUrl(r.back_path),
          selfieUrl: await signedViewUrl(r.selfie_path),
        };
      })
    );

    return ok({ submissions });
  } catch (e) {
    return handleError(e);
  }
}
