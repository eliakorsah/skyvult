import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { serializeTrade } from "../route";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const rl = await checkLimit(req, "trades-open", 60, 60, user.id);
    if (!rl.success) return fail(429, "Too many requests");
    const { data: rows } = await supabaseAdmin
      .from("trades")
      .select("*")
      .eq("user_id", user.id)
      .eq("status", "OPEN")
      .order("created_at", { ascending: false });

    return ok({ trades: (rows ?? []).map(serializeTrade) });
  } catch (e) {
    return handleError(e);
  }
}
