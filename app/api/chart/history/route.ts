import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { isValidAsset } from "@/lib/assets";
import { checkLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

// 24h rolling history of 5s candles. Public endpoint — chart history isn't
// user-specific. Client aggregates larger TFs from these.
export async function GET(req: NextRequest) {
  try {
    const rl = await checkLimit(req, "chart-history", 60, 60);
    if (!rl.success) return fail(429, "Too many requests");

    const { searchParams } = new URL(req.url);
    const asset = searchParams.get("asset") || "";
    if (!isValidAsset(asset)) return fail(400, "Invalid asset");

    const since = Math.floor(Date.now() / 1000) - 24 * 3600;
    // Explicit .range() to override PostgREST's default 1000-row cap.
    // 24h of 5s candles = 17,280 rows; we set headroom for safety.
    const { data, error } = await supabaseAdmin
      .from("chart_candles")
      .select("time,open,high,low,close")
      .eq("asset", asset)
      .gte("time", since)
      .order("time", { ascending: true })
      .range(0, 30_000);
    if (error) return fail(500, "Failed to load history");

    return ok({ asset, candles: data ?? [] });
  } catch (e) {
    return handleError(e);
  }
}
