import { EventEmitter } from "events";
import { supabaseAdmin } from "../lib/supabase";
import { getPayoutRatio } from "../lib/assets";
import { getLastPrice, Tick } from "./priceEngine";
import { withLock } from "../lib/mutex";

export const tradeResultEmitter = new EventEmitter();

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** In-memory cache of every OPEN trade that has TP/SL configured. Populated
 *  by `scheduleLocalSettlement` (which is called both by recoverOpenTrades on
 *  boot and by the periodic DB-poll). `checkPriceTouch` iterates this every
 *  tick to detect first-touch closes. */
type WatchedTrade = {
  id: string;
  asset: string;
  direction: "UP" | "DOWN";
  tpPrice: number;
  slPrice: number;
};
const watching = new Map<string, WatchedTrade>();

// Grace window beyond which we refund a stale open trade instead of settling
// it at the current price (which has no relationship to its true expiry price).
const STALE_TRADE_GRACE_MS = 30_000;


export function scheduleLocalSettlement(tradeId: string, expiresAt: Date): void {
  if (pending.has(tradeId)) return;
  const lag = Date.now() - expiresAt.getTime();
  if (lag > STALE_TRADE_GRACE_MS) {
    // Trade expired more than 30s ago (e.g. server was down) — refund as DRAW.
    refundStale(tradeId).catch((err) =>
      console.error("[settle] stale refund error", tradeId, err?.message),
    );
    return;
  }
  const delay = Math.max(0, expiresAt.getTime() - Date.now());
  const t = setTimeout(async () => {
    pending.delete(tradeId);
    watching.delete(tradeId);
    await settle(tradeId).catch((err) =>
      console.error("[settle] error", tradeId, err?.message)
    );
  }, delay);
  pending.set(tradeId, t);

  // Also cache TP/SL details so checkPriceTouch can close the trade early
  // when the live tick stream crosses either threshold. Failure here is
  // non-fatal — the expiry timer above still resolves the trade at expiry.
  cacheForTouch(tradeId).catch((err) =>
    console.error("[settle] cacheForTouch failed", tradeId, err?.message),
  );
}

async function cacheForTouch(tradeId: string): Promise<void> {
  const { data } = await supabaseAdmin
    .from("trades")
    .select("id, asset, direction, tp_price, sl_price")
    .eq("id", tradeId)
    .eq("status", "OPEN")
    .single();
  if (!data) return;
  if (data.tp_price == null || data.sl_price == null) return; // legacy trade
  watching.set(tradeId, {
    id: data.id,
    asset: data.asset,
    direction: data.direction,
    tpPrice: Number(data.tp_price),
    slPrice: Number(data.sl_price),
  });
}

/** Called on every live tick. Closes any watched trade whose TP or SL was
 *  just crossed. Settlement happens at the *threshold* price (TP or SL),
 *  not the tick price, so users see exactly the level they were promised. */
export function checkPriceTouch(tick: Tick): void {
  for (const [id, w] of watching) {
    if (w.asset !== tick.asset) continue;
    const hitTp =
      (w.direction === "UP"   && tick.price >= w.tpPrice) ||
      (w.direction === "DOWN" && tick.price <= w.tpPrice);
    const hitSl =
      (w.direction === "UP"   && tick.price <= w.slPrice) ||
      (w.direction === "DOWN" && tick.price >= w.slPrice);
    if (!hitTp && !hitSl) continue;

    // Remove from watch + cancel the expiry timer (we're closing now).
    watching.delete(id);
    const timer = pending.get(id);
    if (timer) { clearTimeout(timer); pending.delete(id); }

    const exitPrice = hitTp ? w.tpPrice : w.slPrice;
    const status: "WON" | "LOST" = hitTp ? "WON" : "LOST";
    // Re-arm the watcher if the DB write fails so the next 2s DB-poll picks
    // the trade back up. Without this a touched-but-unwritten trade would
    // sit orphaned in memory until the periodic recovery sweep.
    settleAtTouch(id, status, exitPrice).catch((err) => {
      console.error("[settle] touch settle error", id, err?.message);
      watching.set(id, w);
    });
  }
}

async function refundStale(tradeId: string): Promise<void> {
  const { data: trade } = await supabaseAdmin
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .eq("status", "OPEN")
    .single();
  if (!trade) return;

  const entry = Number(trade.entry_price);
  const amount = Number(trade.amount);

  const { error: updErr } = await supabaseAdmin
    .from("trades")
    .update({
      status: "DRAW",
      exit_price: entry,
      payout: amount,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", tradeId)
    .eq("status", "OPEN");
  if (updErr) return;

  await withLock(`wallet:${trade.user_id}`, async () => {
    const isDemo: boolean = trade.is_demo;
    const col = isDemo ? "demo_balance" : "balance";
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("balance, demo_balance")
        .eq("user_id", trade.user_id)
        .single();
      if (!wallet) return;
      const before = Number(isDemo ? wallet.demo_balance : wallet.balance);
      const after = before + amount;
      const { data: updRows } = await supabaseAdmin
        .from("wallets")
        .update({ [col]: after })
        .eq("user_id", trade.user_id)
        .eq(col, before)
        .select("user_id");
      if (updRows && updRows.length > 0) {
        await supabaseAdmin.from("transactions").insert({
          user_id: trade.user_id,
          type: "TRADE_CREDIT",
          amount,
          balance_before: before,
          balance_after: after,
          reference: tradeId,
          is_demo: isDemo,
        });
        break;
      }
    }
  });

  tradeResultEmitter.emit("result", {
    userId: trade.user_id,
    tradeId,
    status: "DRAW",
    payout: amount,
    exitPrice: entry,
  });
}

/** Close a trade because its TP or SL was just touched. Status and exit
 *  price are forced (we don't recompute from direction), and the wallet
 *  credit / transaction insert paths reuse the same per-user locking as
 *  the expiry-time settle(). Only-update-if-still-OPEN guards against a
 *  race with the expiry timer if it fires at the same instant. */
async function settleAtTouch(tradeId: string, status: "WON" | "LOST", exitPrice: number): Promise<void> {
  const { data: trade } = await supabaseAdmin
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .eq("status", "OPEN")
    .single();
  if (!trade) return;

  const amount = Number(trade.amount);
  const payout = status === "WON" ? amount * getPayoutRatio(trade.asset) : 0;

  const { error: tradeErr } = await supabaseAdmin
    .from("trades")
    .update({
      status,
      exit_price: exitPrice,
      payout,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", tradeId)
    .eq("status", "OPEN");
  if (tradeErr) return; // raced — already settled

  if (payout > 0) {
    await creditWallet(trade.user_id, trade.is_demo, payout, tradeId);
  }

  tradeResultEmitter.emit("result", {
    userId: trade.user_id,
    tradeId,
    status,
    payout,
    exitPrice,
  });
}

/** Per-user serial wallet credit with optimistic retry. Extracted so both
 *  settle() and settleAtTouch() share the exact same payout path. */
async function creditWallet(userId: string, isDemo: boolean, payout: number, tradeId: string): Promise<void> {
  await withLock(`wallet:${userId}`, async () => {
    const col = isDemo ? "demo_balance" : "balance";
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("balance, demo_balance")
        .eq("user_id", userId)
        .single();
      if (!wallet) return;
      const before = Number(isDemo ? wallet.demo_balance : wallet.balance);
      const after = before + payout;
      const { data: updRows } = await supabaseAdmin
        .from("wallets")
        .update({ [col]: after })
        .eq("user_id", userId)
        .eq(col, before)
        .select("user_id");
      if (updRows && updRows.length > 0) {
        await supabaseAdmin.from("transactions").insert({
          user_id: userId,
          type: "TRADE_CREDIT",
          amount: payout,
          balance_before: before,
          balance_after: after,
          reference: tradeId,
          is_demo: isDemo,
        });
        return;
      }
    }
    console.error("[settle] payout failed after retries", tradeId);
  });
}

async function settle(tradeId: string): Promise<void> {
  const { data: trade } = await supabaseAdmin
    .from("trades")
    .select("*")
    .eq("id", tradeId)
    .eq("status", "OPEN")
    .single();
  if (!trade) return;

  let exit = getLastPrice(trade.asset);
  if (exit == null) {
    // Price engine may not have ticked yet — wait one tick and retry once
    await new Promise((r) => setTimeout(r, TICK_INTERVAL_MS + 50));
    exit = getLastPrice(trade.asset);
    if (exit == null) return; // give up; open trade will be recovered on next restart
  }

  const entry = Number(trade.entry_price);
  const amount = Number(trade.amount);

  let status: "WON" | "LOST" | "DRAW";
  if (exit === entry) status = "DRAW";
  else if (trade.direction === "UP") status = exit > entry ? "WON" : "LOST";
  else status = exit < entry ? "WON" : "LOST";

  const payout =
    status === "WON" ? amount * getPayoutRatio(trade.asset) : status === "DRAW" ? amount : 0;

  // Mark trade resolved (optimistic: only update if still OPEN)
  const { error: tradeErr } = await supabaseAdmin
    .from("trades")
    .update({
      status,
      exit_price: exit,
      payout,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", tradeId)
    .eq("status", "OPEN");
  if (tradeErr) return; // another process already settled it

  if (payout > 0) {
    // Serialize wallet credits per-user so simultaneous settlements don't
    // overwrite each other's balance. Retry the optimistic update a few times
    // in case the wallet changes mid-flight.
    await withLock(`wallet:${trade.user_id}`, async () => {
      const isDemo: boolean = trade.is_demo;
      const col = isDemo ? "demo_balance" : "balance";
      for (let attempt = 0; attempt < 5; attempt++) {
        const { data: wallet } = await supabaseAdmin
          .from("wallets")
          .select("balance, demo_balance")
          .eq("user_id", trade.user_id)
          .single();
        if (!wallet) return;

        const before = Number(isDemo ? wallet.demo_balance : wallet.balance);
        const after = before + payout;

        const { data: updRows } = await supabaseAdmin
          .from("wallets")
          .update({ [col]: after })
          .eq("user_id", trade.user_id)
          .eq(col, before)
          .select("user_id");

        if (updRows && updRows.length > 0) {
          await supabaseAdmin.from("transactions").insert({
            user_id: trade.user_id,
            type: "TRADE_CREDIT",
            amount: payout,
            balance_before: before,
            balance_after: after,
            reference: tradeId,
            is_demo: isDemo,
          });
          return;
        }
        // optimistic update failed — someone else raced us; retry
      }
      console.error("[settle] payout failed after retries", tradeId);
    });
  }

  tradeResultEmitter.emit("result", {
    userId: trade.user_id,
    tradeId,
    status,
    payout,
    exitPrice: exit,
  });
}

const TICK_INTERVAL_MS = 100;
