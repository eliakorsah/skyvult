import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const rl = await checkLimit(req, "me", 120, 60, user.id);
    if (!rl.success) return fail(429, "Too many requests");
    const [{ data: wallet }, { data: refRow }] = await Promise.all([
      supabaseAdmin
        .from("wallets")
        .select("balance, demo_balance, is_demo")
        .eq("user_id", user.id)
        .single(),
      supabaseAdmin
        .from("profiles")
        .select("referral_code")
        .eq("id", user.id)
        .single(),
    ]);

    return ok({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      referralCode: refRow?.referral_code ?? null,
      wallet: wallet
        ? {
            balance: Number(wallet.balance),
            demoBalance: Number(wallet.demo_balance),
            isDemo: wallet.is_demo,
          }
        : null,
    });
  } catch (e) {
    return handleError(e);
  }
}
