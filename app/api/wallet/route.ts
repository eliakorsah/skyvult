import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const rl = await checkLimit(req, "wallet", 120, 60, user.id);
    if (!rl.success) return fail(429, "Too many requests");
    const { data: w } = await supabaseAdmin
      .from("wallets")
      .select("balance, demo_balance, is_demo")
      .eq("user_id", user.id)
      .single();
    return ok(
      {
        balance: w ? Number(w.balance) : 0,
        demoBalance: w ? Number(w.demo_balance) : 0,
        isDemo: w?.is_demo ?? false,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return handleError(e);
  }
}
