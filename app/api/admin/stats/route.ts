import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";
import { PAYOUT_RATIO } from "@/lib/assets";

export const runtime = "nodejs";

const MS_DAY = 24 * 60 * 60 * 1000;

// Sums (amount − payout) for resolved real-money trades within a window.
// Negative = users took money from the platform that window. Positive =
// the house won.
async function realizedPnl(sinceIso?: string) {
  let q = supabaseAdmin
    .from("trades")
    .select("amount, payout")
    .eq("is_demo", false)
    .in("status", ["WON", "LOST", "DRAW"]);
  if (sinceIso) q = q.gte("resolved_at", sinceIso);
  const { data } = await q;
  let wagered = 0, paid = 0;
  for (const r of data ?? []) {
    wagered += Number((r as any).amount);
    paid    += Number((r as any).payout);
  }
  return { wagered, paid, pnl: wagered - paid };
}

async function volumeSince(sinceIso: string) {
  const { data } = await supabaseAdmin
    .from("trades")
    .select("amount")
    .eq("is_demo", false)
    .gte("created_at", sinceIso);
  return (data ?? []).reduce((s, r) => s + Number((r as any).amount), 0);
}

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const now = Date.now();
    const since24h = new Date(now - MS_DAY).toISOString();
    const since7d  = new Date(now - 7  * MS_DAY).toISOString();
    const since30d = new Date(now - 30 * MS_DAY).toISOString();

    // Run all the independent reads in parallel — adds a lot of cards but
    // only one HTTP round-trip latency since they overlap.
    const [
      { count: totalUsers },
      { count: blockedUsers },
      { count: activeTrades },
      { data: walletRows },
      { data: openExposureRows },
      { count: referredTotal },
      { count: referredQualified },
      { data: bonusRows },
      vol24, vol7d, vol30d,
      pnl24, pnl7d, pnl30d, pnlAll,
    ] = await Promise.all([
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).eq("blocked", true),
      supabaseAdmin.from("trades").select("id", { count: "exact", head: true }).eq("status", "OPEN"),
      // Total cash we owe users right now (sum of real balances across all wallets).
      supabaseAdmin.from("wallets").select("balance"),
      // Maximum payout we'd owe if every open trade resolved WON simultaneously.
      supabaseAdmin.from("trades").select("amount").eq("is_demo", false).eq("status", "OPEN"),
      // Referral telemetry — total signups via codes vs how many qualified
      // (deposited ≥ MIN_DEPOSIT) and total ₵ paid out as referral bonuses.
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).not("referred_by", "is", null),
      supabaseAdmin.from("profiles").select("id", { count: "exact", head: true }).not("referred_by", "is", null).eq("referral_bonus_paid", true),
      supabaseAdmin.from("transactions").select("amount").eq("type", "REFERRAL_BONUS"),
      volumeSince(since24h),
      volumeSince(since7d),
      volumeSince(since30d),
      realizedPnl(since24h),
      realizedPnl(since7d),
      realizedPnl(since30d),
      realizedPnl(undefined),
    ]);

    const userLiability = (walletRows ?? []).reduce((s, r) => s + Number((r as any).balance), 0);
    const openExposure  = (openExposureRows ?? []).reduce(
      (s, r) => s + Number((r as any).amount) * PAYOUT_RATIO, 0,
    );
    const referralBonusPaid = (bonusRows ?? []).reduce((s, r) => s + Number((r as any).amount), 0);

    // Effective edge across lifetime = realized P&L ÷ total wagered.
    // Drifts close to the configured edge (10%) over volume; sample size
    // varies wildly in week 1.
    const effectiveEdge = pnlAll.wagered > 0 ? pnlAll.pnl / pnlAll.wagered : 0;

    // Daily P&L bars — preserved for the existing chart on the admin page
    const { data: dailyRaw } = await supabaseAdmin.rpc("daily_pnl", { days: 14 });
    const daily = (dailyRaw ?? []).map((r: any) => ({ day: r.day, pnl: Number(r.pnl) }));

    return ok({
      totalUsers:    totalUsers ?? 0,
      blockedUsers:  blockedUsers ?? 0,
      activeTrades:  activeTrades ?? 0,
      // Money we owe users right now (sum of all real wallet balances).
      userLiability,
      // Worst-case if every open trade wins.
      openExposure,
      // Trade volume — different windows
      volume24h: vol24,
      volume7d:  vol7d,
      volume30d: vol30d,
      // Realized house P&L — windows + lifetime
      housePnl24h:    pnl24.pnl,
      housePnl7d:     pnl7d.pnl,
      housePnl30d:    pnl30d.pnl,
      housePnlAll:    pnlAll.pnl,
      // Wagered totals (volume of resolved real trades)
      wageredAll:     pnlAll.wagered,
      paidAll:        pnlAll.paid,
      effectiveEdge,   // 0..1 — sanity check vs configured PAYOUT_RATIO
      // Edge = −EV per ₵ wagered = 0.5 × (1 − (PAYOUT_RATIO − 1)). For
      // PAYOUT_RATIO 1.80 this is 0.10 → matches the 10% house cut we set.
      configuredEdge: 0.5 * (2 - PAYOUT_RATIO),
      // Referral channel telemetry — net CAC is bonusPaid ÷ qualifiedReferrals.
      referredTotal:     referredTotal ?? 0,
      referredQualified: referredQualified ?? 0,
      referralBonusPaid,
      daily,
    });
  } catch (e) {
    return handleError(e);
  }
}
