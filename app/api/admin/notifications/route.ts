import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";

export const runtime = "nodejs";

/** Lightweight poll target for the admin notification bell — counts only,
 *  no row data. Polled from every page (via Nav) for ADMIN users, so this
 *  must stay cheap (head-count queries, no joins/pagination). */
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const [pendingPayments, openMessages, pendingKyc] = await Promise.all([
      supabaseAdmin.from("payments").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
      supabaseAdmin.from("support_messages").select("id", { count: "exact", head: true }).eq("status", "OPEN"),
      supabaseAdmin.from("kyc_submissions").select("id", { count: "exact", head: true }).eq("status", "PENDING"),
    ]);

    const counts = {
      pendingPayments: pendingPayments.count ?? 0,
      openMessages:    openMessages.count ?? 0,
      pendingKyc:      pendingKyc.count ?? 0,
    };

    return ok({ ...counts, total: counts.pendingPayments + counts.openMessages + counts.pendingKyc });
  } catch (e) {
    return handleError(e);
  }
}
