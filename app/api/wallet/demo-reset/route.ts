import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { withLock } from "@/lib/mutex";
import { checkLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const DEMO_DEFAULT   = 10_000;
const DEMO_ALLOWED   = [10_000, 50_000, 100_000, 500_000];

const Schema = z.object({
  amount: z.number().int().positive().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);

    const body   = Schema.safeParse(await req.json().catch(() => ({})));
    const target = body.success && body.data.amount
      ? body.data.amount
      : DEMO_DEFAULT;

    if (!DEMO_ALLOWED.includes(target))
      return fail(400, `Choose one of: ₵${DEMO_ALLOWED.map((a) => a.toLocaleString()).join(", ")}`);

    const rl = await checkLimit(req, "demo-reset", 10, 300, user.id);
    if (!rl.success) return fail(429, "Too many top-ups — try again in a moment");

    return await withLock(`demo-reset:${user.id}`, async () => {
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("demo_balance")
        .eq("user_id", user.id)
        .single();
      if (!wallet) return fail(404, "Wallet not found");

      const before = Number(wallet.demo_balance);
      const after  = target;

      const { error: updErr } = await supabaseAdmin
        .from("wallets")
        .update({ demo_balance: after })
        .eq("user_id", user.id);
      if (updErr) return fail(500, "Failed to reset demo balance");

      await supabaseAdmin.from("transactions").insert({
        user_id: user.id,
        type: "DEMO_RESET",
        amount: after - before,
        balance_before: before,
        balance_after: after,
        reference: "demo-refresh",
        is_demo: true,
      });

      return ok({ demoBalance: after });
    });
  } catch (e) {
    return handleError(e);
  }
}
