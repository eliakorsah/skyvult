import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const { data: profiles } = await supabaseAdmin
      .from("profiles")
      .select("id, name, role, blocked, created_at")
      .order("created_at", { ascending: false })
      .limit(200);

    const userIds = (profiles ?? []).map((p: any) => p.id);
    const { data: wallets } = await supabaseAdmin
      .from("wallets")
      .select("user_id, balance, demo_balance")
      .in("user_id", userIds);

    const walletMap = Object.fromEntries(
      (wallets ?? []).map((w: any) => [w.user_id, w])
    );

    // Get emails from auth — paginate so users beyond the default page aren't blank
    const emailMap: Record<string, string> = {};
    {
      const need = new Set(userIds);
      const perPage = 200;
      for (let page = 1; page <= 20 && need.size > 0; page++) {
        const { data: authUsers, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage });
        if (error) break;
        const list = authUsers?.users ?? [];
        for (const u of list) {
          if (need.has(u.id) && u.email) {
            emailMap[u.id] = u.email;
            need.delete(u.id);
          }
        }
        if (list.length < perPage) break;
      }
    }

    return ok({
      users: (profiles ?? []).map((p: any) => ({
        id: p.id,
        name: p.name,
        email: emailMap[p.id] ?? "",
        role: p.role,
        blocked: p.blocked,
        createdAt: p.created_at,
        wallet: walletMap[p.id]
          ? {
              balance: Number(walletMap[p.id].balance),
              demoBalance: Number(walletMap[p.id].demo_balance),
            }
          : null,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}
