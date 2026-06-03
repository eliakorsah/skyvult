import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { redis, KEYS } from "@/lib/redis";
import { scheduleSettlement } from "@/lib/queue";
import { ok, fail, handleError } from "@/lib/http";
import { isValidAsset, RISK, EXPIRY_OPTIONS, tpSlDistance } from "@/lib/assets";
import { withLock } from "@/lib/mutex";
import { checkLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Schema = z.object({
  asset: z.string(),
  direction: z.enum(["UP", "DOWN"]),
  amount: z.number().positive(),
  expirySeconds: z.number().int().positive(),
  isDemo: z.boolean().optional().default(false),
});

/** Get a price fresh enough to stamp on a trade. Order of preference:
 *    1. WS server's in-memory live price via internal HTTP (sub-50ms old)
 *    2. Redis mirror (per-tick mirror from the price engine)
 *    3. Most recent persisted candle in Supabase (up to one persist-batch
 *       stale, ~3s)
 *
 *  This matters financially: clients see live ticks through the WS and can
 *  visually time entries. If the server stamps an older price, a fast-moving
 *  tick gives the user a guaranteed-favorable entry. Querying the WS server
 *  closes that gap in dev / single-host deployments. */
const INTERNAL_PORT  = Number(process.env.WS_INTERNAL_PORT || 3002);
const INTERNAL_TOKEN = process.env.WS_INTERNAL_TOKEN || "";

async function fetchLivePriceFromWs(asset: string): Promise<number | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 50);
    const res = await fetch(`http://127.0.0.1:${INTERNAL_PORT}/price?asset=${encodeURIComponent(asset)}`, {
      headers: INTERNAL_TOKEN ? { "x-internal-token": INTERNAL_TOKEN } : {},
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return null;
    const j = await res.json();
    return typeof j?.price === "number" ? j.price : null;
  } catch {
    return null;
  }
}

async function getLivePrice(asset: string): Promise<number | null> {
  const live = await fetchLivePriceFromWs(asset);
  if (live != null) return live;
  try {
    const raw = await redis.get<{ price: number }>(KEYS.lastPrice(asset));
    if (raw?.price != null) return raw.price;
  } catch {
    // Redis not configured or unreachable — fall through to DB
  }
  try {
    const { data } = await supabaseAdmin
      .from("chart_candles")
      .select("close")
      .eq("asset", asset)
      .order("time", { ascending: false })
      .limit(1)
      .single();
    return data?.close ?? null;
  } catch {
    return null;
  }
}

export function serializeTrade(t: Record<string, any>) {
  return {
    id: t.id,
    asset: t.asset,
    direction: t.direction,
    amount: Number(t.amount),
    entryPrice: Number(t.entry_price),
    exitPrice: t.exit_price != null ? Number(t.exit_price) : null,
    tpPrice:   t.tp_price != null ? Number(t.tp_price) : null,
    slPrice:   t.sl_price != null ? Number(t.sl_price) : null,
    expirySeconds: t.expiry_seconds,
    expiresAt: t.expires_at,
    status: t.status,
    payout: Number(t.payout),
    isDemo: t.is_demo,
    createdAt: t.created_at,
    resolvedAt: t.resolved_at,
  };
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const body = Schema.parse(await req.json());

    if (!isValidAsset(body.asset)) return fail(400, "Invalid asset");
    if (!EXPIRY_OPTIONS.includes(body.expirySeconds)) return fail(400, "Invalid expiry");
    if (body.amount < RISK.MIN_TRADE) return fail(400, `Minimum trade is GHS ${RISK.MIN_TRADE}`);
    if (body.amount > RISK.MAX_TRADE) return fail(400, `Maximum trade is GHS ${RISK.MAX_TRADE}`);

    // Rate limit: 20 trade attempts / 10s per user (prevents spam / botting)
    const rl = await checkLimit(req, "trade", 20, 10, user.id);
    if (!rl.success) return fail(429, "Slow down — too many trade requests");

    // Serialize per-user to close the read-modify-write race window on the wallet.
    return await withLock(`trade:${user.id}`, async () => {
      const [{ count: openCount }, price, { data: wallet }] = await Promise.all([
        supabaseAdmin
          .from("trades")
          .select("id", { count: "exact", head: true })
          .eq("user_id", user.id)
          .eq("status", "OPEN"),
        getLivePrice(body.asset),
        supabaseAdmin
          .from("wallets")
          .select("balance, demo_balance")
          .eq("user_id", user.id)
          .single(),
      ]);

      if ((openCount ?? 0) >= RISK.MAX_OPEN_PER_USER)
        return fail(429, `Max ${RISK.MAX_OPEN_PER_USER} open trades`);
      if (price == null) return fail(503, "Price feed unavailable, try again");
      if (!wallet) return fail(404, "Wallet not found");

      const before = Number(body.isDemo ? wallet.demo_balance : wallet.balance);
      if (before < body.amount) return fail(400, "Insufficient balance");
      const after = before - body.amount;

      // Optimistic concurrency: only update if the balance is still what we read.
      const updCol = body.isDemo ? "demo_balance" : "balance";
      const { data: updRows, error: updErr } = await supabaseAdmin
        .from("wallets")
        .update({ [updCol]: after })
        .eq("user_id", user.id)
        .eq(updCol, before)
        .select("user_id");
      if (updErr || !updRows || updRows.length === 0) {
        return fail(409, "Balance changed — please retry");
      }

      const expiresAt = new Date(Date.now() + body.expirySeconds * 1000);

      // Symmetric, volatility-scaled TP/SL prices stored alongside the trade.
      // Settlement worker watches live ticks and closes the trade the moment
      // price touches either side. If neither is touched by expiry it falls
      // back to direction-at-expiry settlement.
      const distance = tpSlDistance(body.asset, body.expirySeconds);
      const tpPrice  = body.direction === "UP" ? price + distance : price - distance;
      const slPrice  = body.direction === "UP" ? price - distance : price + distance;

      const { data: trade, error: tradeErr } = await supabaseAdmin
        .from("trades")
        .insert({
          user_id: user.id,
          asset: body.asset,
          direction: body.direction,
          amount: body.amount,
          entry_price: price,
          tp_price: tpPrice,
          sl_price: slPrice,
          expiry_seconds: body.expirySeconds,
          expires_at: expiresAt.toISOString(),
          status: "OPEN",
          payout: 0,
          is_demo: body.isDemo,
        })
        .select()
        .single();

      if (tradeErr || !trade) {
        // Refund as a delta (+amount) using optimistic concurrency. A blind
        // "set back to `before`" would clobber any settlement credit that
        // landed between the debit and this refund, since settlements run
        // in a separate process and aren't covered by `withLock`. Retry up
        // to 5 times to ride out concurrent updates.
        for (let attempt = 0; attempt < 5; attempt++) {
          const { data: curWallet } = await supabaseAdmin
            .from("wallets")
            .select("balance, demo_balance")
            .eq("user_id", user.id)
            .single();
          if (!curWallet) break;
          const curBal = Number(body.isDemo ? curWallet.demo_balance : curWallet.balance);
          const { data: refRows } = await supabaseAdmin
            .from("wallets")
            .update({ [updCol]: curBal + body.amount })
            .eq("user_id", user.id)
            .eq(updCol, curBal)
            .select("user_id");
          if (refRows && refRows.length > 0) break;
        }
        return fail(500, "Failed to create trade");
      }

      await supabaseAdmin.from("transactions").insert({
        user_id: user.id,
        type: "TRADE_DEBIT",
        amount: body.amount,
        balance_before: before,
        balance_after: after,
        reference: trade.id,
        is_demo: body.isDemo,
      });

      if (body.amount > RISK.LARGE_TRADE_THRESHOLD) {
        await supabaseAdmin.from("large_trade_logs").insert({
          user_id: user.id,
          trade_id: trade.id,
          asset: body.asset,
          amount: body.amount,
        });
      }

      // Fire-and-forget — the WS server also schedules from DB on startup
      scheduleSettlement(trade.id, expiresAt).catch(() => {});

      return ok(serializeTrade(trade));
    });
  } catch (e) {
    return handleError(e);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 25)));
    const from = (page - 1) * limit;

    let query = supabaseAdmin
      .from("trades")
      .select("*", { count: "exact" })
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .range(from, from + limit - 1);

    if (status && ["OPEN", "WON", "LOST", "DRAW"].includes(status))
      query = query.eq("status", status);

    const { data: rows, count } = await query;

    return ok({
      page,
      limit,
      total: count ?? 0,
      trades: (rows ?? []).map(serializeTrade),
    });
  } catch (e) {
    return handleError(e);
  }
}
