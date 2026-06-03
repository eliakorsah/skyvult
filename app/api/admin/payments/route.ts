import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const sp     = new URL(req.url).searchParams;
    const limit  = Math.min(Number(sp.get("limit") || 100), 500);
    const VALID_TYPES   = ["DEPOSIT", "WITHDRAWAL"];
    const VALID_STATUSES = ["PENDING", "SUCCESS", "FAILED", "ABANDONED"];
    const type   = sp.get("type");
    const status = sp.get("status");

    let q = supabaseAdmin
      .from("payments")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (type   && VALID_TYPES.includes(type))     q = q.eq("type", type);
    if (status && VALID_STATUSES.includes(status)) q = q.eq("status", status);

    const { data: rows, error } = await q;
    if (error) throw error;

    // Build user info map
    const userIds = [...new Set((rows ?? []).map((p: any) => p.user_id as string))];
    const nameMap: Record<string, string> = {};
    const emailMap: Record<string, string> = {};

    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin
        .from("profiles")
        .select("id, name")
        .in("id", userIds);
      for (const p of profiles ?? []) nameMap[p.id] = p.name;

      const need = new Set(userIds);
      for (let page = 1; page <= 10 && need.size > 0; page++) {
        const { data: auth } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
        for (const u of auth?.users ?? []) {
          if (need.has(u.id) && u.email) {
            emailMap[u.id] = u.email;
            need.delete(u.id);
          }
        }
        if ((auth?.users ?? []).length < 200) break;
      }
    }

    // Summary from all payments (not filtered)
    const { data: all } = await supabaseAdmin.from("payments").select("type, status, amount");
    const summary = {
      totalDeposits:    (all ?? []).filter(p => p.type === "DEPOSIT"    && p.status === "SUCCESS").reduce((s, p) => s + Number(p.amount), 0),
      totalWithdrawals: (all ?? []).filter(p => p.type === "WITHDRAWAL" && p.status === "SUCCESS").reduce((s, p) => s + Number(p.amount), 0),
      pendingCount:     (all ?? []).filter(p => p.status === "PENDING").length,
      failedCount:      (all ?? []).filter(p => p.status === "FAILED").length,
    };

    return ok({
      summary,
      payments: (rows ?? []).map((p: any) => ({
        id:                p.id,
        userId:            p.user_id,
        type:              p.type,
        amount:            Number(p.amount),
        status:            p.status,
        mobileProvider:    p.mobile_provider,
        mobileNumber:      p.mobile_number,
        failureReason:     p.failure_reason,
        providerReference: p.provider_reference,
        createdAt:         p.created_at,
        resolvedAt:        p.resolved_at,
        user: { name: nameMap[p.user_id] ?? "", email: emailMap[p.user_id] ?? "" },
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
