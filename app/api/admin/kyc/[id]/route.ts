import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";

export const runtime = "nodejs";

const Schema = z.object({
  action: z.enum(["approve", "reject"]),
  reason: z.string().max(300).optional(),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin(req);
    const body = Schema.parse(await req.json());
    const { id } = params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return fail(400, "Invalid ID");

    const { data: submission } = await supabaseAdmin
      .from("kyc_submissions")
      .select("id, user_id, status, mobile_number, mobile_provider, mobile_name")
      .eq("id", id)
      .single();

    if (!submission) return fail(404, "Submission not found");
    if (submission.status !== "PENDING") return fail(400, `Submission is already ${submission.status}`);

    const newStatus = body.action === "approve" ? "APPROVED" : "REJECTED";

    await supabaseAdmin
      .from("kyc_submissions")
      .update({
        status:           newStatus,
        rejection_reason: body.action === "reject" ? (body.reason ?? "Rejected by admin") : null,
        resolved_at:      new Date().toISOString(),
      })
      .eq("id", id);

    const profileUpdate: Record<string, any> = { kyc_status: newStatus };
    if (newStatus === "APPROVED" && submission.mobile_number) {
      profileUpdate.verified_mobile_number   = submission.mobile_number;
      profileUpdate.verified_mobile_provider = submission.mobile_provider;
      profileUpdate.verified_mobile_name     = submission.mobile_name;
    }
    await supabaseAdmin
      .from("profiles")
      .update(profileUpdate)
      .eq("id", submission.user_id);

    return ok({ status: newStatus });
  } catch (e) {
    return handleError(e);
  }
}
