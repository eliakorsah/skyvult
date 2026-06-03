import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 25)));
    const from = (page - 1) * limit;

    const { data: rows, count } = await supabaseAdmin
      .from("transactions")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    return ok({
      page,
      limit,
      total: count ?? 0,
      transactions: (rows ?? []).map((t: Record<string, any>) => ({
        id: t.id,
        type: t.type,
        amount: Number(t.amount),
        balanceBefore: Number(t.balance_before),
        balanceAfter: Number(t.balance_after),
        reference: t.reference,
        isDemo: t.is_demo,
        createdAt: t.created_at,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
