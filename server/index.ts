import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { parse } from "url";
import { createClient } from "@supabase/supabase-js";
import { startPriceEngine, getSnapshot, getLastPrice, Tick } from "./priceEngine";
import { scheduleLocalSettlement, tradeResultEmitter, checkPriceTouch } from "./settlementWorker";
import { pollSettlementQueue } from "../lib/queue";
import { ASSETS } from "../lib/assets";

// Dedicated WS_PORT so the WebSocket server never collides with Next.js,
// which uses PORT (3000 in production). nginx proxies /ws to this port.
const PORT = Number(process.env.WS_PORT || 3001);
const INTERNAL_PORT = Number(process.env.WS_INTERNAL_PORT || 3002);
const INTERNAL_TOKEN = process.env.WS_INTERNAL_TOKEN || "";
if (!INTERNAL_TOKEN) console.warn("[SECURITY] WS_INTERNAL_TOKEN is not set — internal price endpoint will reject all requests. Set it in .env.local.");
const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPA_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabaseAdmin = createClient(SUPA_URL, SUPA_SERVICE, {
  auth: { autoRefreshToken: false, persistSession: false },
  // Node.js < 22 has no native WebSocket — supply the ws package so Supabase
  // realtime doesn't throw on startup.
  realtime: { transport: WebSocket },
});

type Client = { ws: WebSocket; userId: string | null };
const clients = new Set<Client>();

function broadcastPrice(tick: Tick) {
  // Closes any OPEN trade whose TP/SL was just crossed. Runs synchronously
  // before the broadcast so latency to clients is unaffected and a
  // settle-resulting trade-result message can immediately follow the price
  // tick that triggered it.
  checkPriceTouch(tick);

  const msg = JSON.stringify({ type: "price", tick });
  for (const c of clients) {
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(msg);
  }
}

async function validateToken(token: string): Promise<string | null> {
  try {
    const { data: { user } } = await supabaseAdmin.auth.getUser(token);
    return user?.id ?? null;
  } catch {
    return null;
  }
}

async function recoverOpenTrades() {
  const { data } = await supabaseAdmin
    .from("trades")
    .select("id, expires_at")
    .eq("status", "OPEN");
  for (const t of data ?? []) {
    scheduleLocalSettlement(t.id, new Date(t.expires_at));
  }
  if (data?.length) console.log(`[ws] recovered ${data.length} open trades`);
}

async function pollQueue() {
  try {
    let job = await pollSettlementQueue();
    while (job) {
      scheduleLocalSettlement(job.tradeId, new Date(job.expiresAt));
      job = await pollSettlementQueue();
    }
  } catch {
    // non-fatal
  }
}

// Fallback for when Upstash isn't configured (or the queue push from the Next
// process silently fails): poll Supabase directly for any OPEN trades and
// schedule their settlement locally. `scheduleLocalSettlement` dedupes by
// tradeId, so calling this for trades we've already scheduled is a no-op.
async function pollOpenTradesFromDb() {
  try {
    const { data } = await supabaseAdmin
      .from("trades")
      .select("id, expires_at")
      .eq("status", "OPEN");
    for (const t of data ?? []) {
      scheduleLocalSettlement(t.id, new Date(t.expires_at));
    }
  } catch (err: any) {
    console.error("[ws] pollOpenTradesFromDb error:", err?.message);
  }
}

async function main() {
  // Bind to 0.0.0.0 so mobile devices on the same Wi-Fi network can connect
  // via the dev machine's LAN IP (e.g. ws://192.168.x.x:3001).
  const wss = new WebSocketServer({ port: PORT, host: "0.0.0.0" });
  console.log(`[ws] listening on 0.0.0.0:${PORT}`);

  // Price feed is public data — anyone can subscribe. Trade-result events are
  // still scoped per userId below, so unauthenticated subs can't see anyone's
  // trades. Set WS_REQUIRE_AUTH=true to enforce auth on the price feed too.
  const REQUIRE_AUTH = process.env.WS_REQUIRE_AUTH === "true";

  wss.on("connection", async (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[ws] client connect from ${ip}, url=${req.url}`);

    // Wrap everything in try/catch so a crash in this handler doesn't take
    // down the server or close the connection silently.
    try {
      const { query } = parse(req.url || "", true);
      const userId = query.token ? await validateToken(String(query.token)) : null;
      console.log(`[ws] auth: userId=${userId ?? "(anon)"}`);

      if (REQUIRE_AUTH && !userId) {
        console.log(`[ws] rejecting unauthenticated connection`);
        ws.send(JSON.stringify({ type: "error", error: "unauthorized" }));
        ws.close(4001, "unauthorized");
        return;
      }

      const client: Client = { ws, userId };
      clients.add(client);

      // Chart history is fetched directly from Supabase via /api/chart/history.
      // Here we only send the recent tick tail so the in-progress candle
      // paints smoothly the moment the client connects.
      for (const a of ASSETS) {
        const ticks = await getSnapshot(a.symbol).catch(() => [] as Tick[]);
        if (ws.readyState !== WebSocket.OPEN) break;
        ws.send(JSON.stringify({ type: "snapshot", asset: a.symbol, ticks }));
      }
      console.log(`[ws] sent initial tick snapshots for ${ASSETS.length} assets`);

      ws.on("close", (code, reason) => {
        console.log(`[ws] client disconnect code=${code} reason=${reason?.toString() || ""}`);
        clients.delete(client);
      });
      ws.on("error", (err) => {
        console.log(`[ws] client error: ${err?.message}`);
        clients.delete(client);
      });
    } catch (err: any) {
      console.error(`[ws] connection handler crashed:`, err?.message, err?.stack);
      try { ws.close(1011, "server error"); } catch {}
    }
  });

  // Forward trade results to the relevant user's WS connection(s). Defensive
  // guard on userId: without it a malformed/null userId would broadcast to
  // every anonymous client (since null === null).
  tradeResultEmitter.on("result", (data: {
    userId: string; tradeId: string; status: string; payout: number; exitPrice: number;
  }) => {
    if (!data?.userId || typeof data.userId !== "string") return;
    const msg = JSON.stringify({
      type: "trade-result",
      tradeId: data.tradeId,
      status: data.status,
      payout: data.payout,
      exitPrice: data.exitPrice,
    });
    for (const c of clients) {
      if (c.userId === data.userId && c.ws.readyState === WebSocket.OPEN) {
        c.ws.send(msg);
      }
    }
  });

  startPriceEngine(broadcastPrice);

  // Internal HTTP endpoint the Next.js trade route hits to get the truly
  // live in-memory price (instead of falling back to a candle row that can
  // be up to one persist-batch interval stale). Bound to 127.0.0.1 only —
  // the WS server and Next.js share a host in dev/single-VPS deployments.
  // Shared-secret gate so an attacker who somehow reaches localhost still
  // can't read internal prices without the token.
  const internalServer = http.createServer((req, res) => {
    if (!req.url) { res.statusCode = 400; res.end(); return; }
    // Require the token always — an empty/missing WS_INTERNAL_TOKEN env var
    // means the server won't start rather than silently granting open access.
    if (!INTERNAL_TOKEN || req.headers["x-internal-token"] !== INTERNAL_TOKEN) {
      res.statusCode = 401; res.end("unauthorized"); return;
    }
    const u = new URL(req.url, "http://localhost");
    if (u.pathname === "/price") {
      const asset = u.searchParams.get("asset") || "";
      const price = getLastPrice(asset);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ asset, price }));
      return;
    }
    res.statusCode = 404;
    res.end();
  });
  internalServer.listen(INTERNAL_PORT, "127.0.0.1", () => {
    console.log(`[ws] internal price endpoint on 127.0.0.1:${INTERNAL_PORT}`);
  });

  await recoverOpenTrades().catch(() => {});

  // Poll the Upstash queue for new settlement jobs from Next.js API routes
  setInterval(pollQueue, 500);

  // Fallback: poll Supabase every 2s for any OPEN trade not yet scheduled.
  // This is what makes settlement work in dev without a real Redis/Upstash.
  setInterval(pollOpenTradesFromDb, 2000);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
