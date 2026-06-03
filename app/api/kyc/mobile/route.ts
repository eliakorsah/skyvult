import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { data } = await supabaseAdmin
      .from("profiles")
      .select("kyc_status, verified_mobile_number, verified_mobile_provider")
      .eq("id", user.id)
      .single();

    return ok({
      kycStatus:             data?.kyc_status ?? "NONE",
      verifiedMobileNumber:  data?.verified_mobile_number  ?? null,
      verifiedMobileProvider: data?.verified_mobile_provider ?? null,
    });
  } catch (e) {
    return handleError(e);
  }
}
