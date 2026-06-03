import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { withLock } from "@/lib/mutex";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const Schema = z.object({
  blocked:      z.boolean().optional(),
  // Cap manual balance adjustments to a sane ceiling — prevents accidental or
  // malicious inflation. Admin sets exact new balance, not a delta.
  balance:      z.number().min(0).max(1_000_000).optional(),
  demoBalance:  z.number().min(0).max(10_000_000).optional(),
  reason:       z.string().max(200).optional(),
});

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin(req);
    if (!UUID_RE.test(params.id)) return fail(400, "Invalid user ID");
    const body = Schema.parse(await req.json());

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("id", params.id)
      .single();
    if (!profile) return fail(404, "User not found");

    if (typeof body.blocked === "boolean") {
      await supabaseAdmin.from("profiles").update({ blocked: body.blocked }).eq("id", params.id);
      await supabaseAdmin.from("transactions").insert({
        user_id:        params.id,
        type:           body.blocked ? "ADMIN_BLOCK" : "ADMIN_UNBLOCK",
        amount:         0,
        balance_before: 0,
        balance_after:  0,
        reference:      `admin:${admin.id}:${body.reason ?? ""}`,
        is_demo:        false,
      });
    }

    if (body.balance !== undefined || body.demoBalance !== undefined) {
      await withLock(`wallet:${params.id}`, async () => {
        const { data: w } = await supabaseAdmin
          .from("wallets").select("balance, demo_balance").eq("user_id", params.id).single();
        if (!w) return;
        const upd: Record<string, number> = {};
        if (body.balance     !== undefined) upd.balance      = body.balance;
        if (body.demoBalance !== undefined) upd.demo_balance = body.demoBalance;
        await supabaseAdmin.from("wallets").update(upd).eq("user_id", params.id);

        // Audit every balance change in the transaction ledger
        if (body.balance !== undefined) {
          await supabaseAdmin.from("transactions").insert({
            user_id:        params.id,
            type:           "ADMIN_ADJUSTMENT",
            amount:         body.balance - Number(w.balance),
            balance_before: Number(w.balance),
            balance_after:  body.balance,
            reference:      `admin:${admin.id}:${body.reason ?? "manual"}`,
            is_demo:        false,
          });
        }
        if (body.demoBalance !== undefined) {
          await supabaseAdmin.from("transactions").insert({
            user_id:        params.id,
            type:           "ADMIN_ADJUSTMENT",
            amount:         body.demoBalance - Number(w.demo_balance),
            balance_before: Number(w.demo_balance),
            balance_after:  body.demoBalance,
            reference:      `admin:${admin.id}:${body.reason ?? "manual"}`,
            is_demo:        true,
          });
        }
      });
    }

    return ok({ success: true });
  } catch (e) {
    return handleError(e);
  }
}
