import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";
import { serializeTrade } from "@/lib/serializeTrade";

export const runtime = "nodejs";

async function emailMapFor(userIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const need = new Set(userIds);
  // Paginate listUsers until we've matched every user we need (or run out)
  let page = 1;
  const perPage = 200;
  // Cap pages so we never spin forever
  for (let i = 0; i < 50 && need.size > 0; i++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data?.users ?? [];
    for (const u of users) {
      if (need.has(u.id) && u.email) {
        out[u.id] = u.email;
        need.delete(u.id);
      }
    }
    if (users.length < perPage) break;
    page += 1;
  }
  return out;
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 25)));
    const from = (page - 1) * limit;

    const { data: rows, count } = await supabaseAdmin
      .from("trades")
      .select("*", { count: "exact" })
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    const userIds = Array.from(new Set((rows ?? []).map((t: any) => t.user_id as string)));

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, name")
      .in("id", userIds);
    const nameMap: Record<string, string> = {};
    for (const p of profiles ?? []) nameMap[(p as any).id] = (p as any).name;

    const emails = await emailMapFor(userIds);

    return ok({
      page,
      limit,
      total: count ?? 0,
      trades: (rows ?? []).map((t: Record<string, any>) => ({
        ...serializeTrade(t),
        user: { name: nameMap[t.user_id] ?? "", email: emails[t.user_id] ?? "" },
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
