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
    // Core balance read — only columns guaranteed to exist. Keeping the bonus
    // columns out of this query means balances still render even if the
    // wagering migration (011) hasn't been applied yet.
    const { data: w } = await supabaseAdmin
      .from("wallets")
      .select("balance, demo_balance, is_demo")
      .eq("user_id", user.id)
      .single();

    // Bonus lock is best-effort: if the columns don't exist yet, this query
    // errors silently and we fall back to 0 (no lock).
    let bonusLocked = 0, wageringRemaining = 0;
    const { data: b } = await supabaseAdmin
      .from("wallets")
      .select("bonus_locked, wagering_remaining")
      .eq("user_id", user.id)
      .single();
    if (b) {
      bonusLocked = Number(b.bonus_locked ?? 0);
      wageringRemaining = Number(b.wagering_remaining ?? 0);
    }

    return ok(
      {
        balance: w ? Number(w.balance) : 0,
        demoBalance: w ? Number(w.demo_balance) : 0,
        isDemo: w?.is_demo ?? false,
        bonusLocked,
        wageringRemaining,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return handleError(e);
  }
}
