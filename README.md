# TradeGH

Binary options trading platform built for Ghana. All amounts in Ghana Cedis (₵). 82% payout on winning trades.

**Educational/demo only — no real payment integration.**

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js 14 (App Router) + TailwindCSS + TradingView Lightweight Charts |
| Backend | Next.js API routes + standalone Node.js WebSocket server |
| Database | Supabase (PostgreSQL) |
| Auth | Supabase Auth |
| Cache / Queue | Upstash Redis (REST) |
| Real-time | `ws` WebSocket server with live price feed |

---

## Setup

### 1. Clone and install

```bash
git clone <repo>
cd tradeph
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com) → New project (free tier works)
2. Once created, go to **Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon / public key** → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role key** → `SUPABASE_SERVICE_ROLE_KEY`
3. Go to **Authentication → Providers → Email** and **disable** "Confirm email" for local dev

### 3. Run the SQL schema in Supabase

Go to **SQL Editor** in your Supabase dashboard and run the full SQL block from the section below.

### 4. Create an Upstash Redis database

1. Go to [upstash.com](https://upstash.com) → Create database (free tier works)
2. Copy **REST URL** → `UPSTASH_REDIS_REST_URL`
3. Copy **REST Token** → `UPSTASH_REDIS_REST_TOKEN`

### 5. Configure environment

```bash
cp .env.example .env.local
# Fill in the four Supabase + Upstash values
```

### 6. Start the app

```bash
npm run dev
```

This starts both:
- Next.js on `http://localhost:3000`
- WebSocket + price feed + settlement worker on `ws://localhost:3001`

---

## Supabase SQL Schema

Run this entire block in **SQL Editor → New query**:

```sql
-- Profiles (one per auth user)
CREATE TABLE profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'USER',
  blocked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets
CREATE TABLE wallets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  balance      NUMERIC(18,2) NOT NULL DEFAULT 0,
  demo_balance NUMERIC(18,2) NOT NULL DEFAULT 1000,
  is_demo      BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Trades
CREATE TABLE trades (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  asset          TEXT NOT NULL,
  direction      TEXT NOT NULL CHECK (direction IN ('UP','DOWN')),
  amount         NUMERIC(18,2) NOT NULL,
  entry_price    NUMERIC(18,8) NOT NULL,
  exit_price     NUMERIC(18,8),
  expiry_seconds INT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  status         TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','WON','LOST','DRAW')),
  payout         NUMERIC(18,2) NOT NULL DEFAULT 0,
  is_demo        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  resolved_at    TIMESTAMPTZ
);
CREATE INDEX trades_user_status ON trades(user_id, status);
CREATE INDEX trades_status_expires ON trades(status, expires_at);

-- Transactions
CREATE TABLE transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('DEPOSIT','WITHDRAWAL','TRADE_DEBIT','TRADE_CREDIT')),
  amount         NUMERIC(18,2) NOT NULL,
  balance_before NUMERIC(18,2) NOT NULL,
  balance_after  NUMERIC(18,2) NOT NULL,
  reference      TEXT,
  is_demo        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX transactions_user ON transactions(user_id, created_at DESC);

-- Large trade audit log
CREATE TABLE large_trade_logs (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  trade_id   UUID NOT NULL,
  asset      TEXT NOT NULL,
  amount     NUMERIC(18,2) NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ─── Row Level Security ──────────────────────────────────────────────────────
ALTER TABLE profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE wallets        ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades         ENABLE ROW LEVEL SECURITY;
ALTER TABLE transactions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE large_trade_logs ENABLE ROW LEVEL SECURITY;

-- Profiles
CREATE POLICY "own profile read"   ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "own profile update" ON profiles FOR UPDATE USING (auth.uid() = id);

-- Wallets
CREATE POLICY "own wallet read"   ON wallets FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own wallet update" ON wallets FOR UPDATE USING (auth.uid() = user_id);

-- Trades
CREATE POLICY "own trades read"   ON trades FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "own trades insert" ON trades FOR INSERT WITH CHECK (auth.uid() = user_id);

-- Transactions
CREATE POLICY "own transactions read" ON transactions FOR SELECT USING (auth.uid() = user_id);

-- ─── Daily P&L helper (used by /api/admin/stats) ─────────────────────────────
CREATE OR REPLACE FUNCTION daily_pnl(days INT DEFAULT 14)
RETURNS TABLE(day DATE, pnl NUMERIC) LANGUAGE sql STABLE AS $$
  SELECT
    DATE(resolved_at) AS day,
    COALESCE(SUM(amount),0) - COALESCE(SUM(payout),0) AS pnl
  FROM trades
  WHERE is_demo = false
    AND status IN ('WON','LOST','DRAW')
    AND resolved_at >= NOW() - (days || ' days')::INTERVAL
  GROUP BY 1
  ORDER BY 1 ASC;
$$;
```

> **Note:** The service-role key used server-side bypasses all RLS — you do not need service-role policies. RLS protects direct database access from the browser.

---

## Seed accounts (optional)

Register two accounts via the `/auth` page (or Supabase dashboard → Authentication → Users), then run in the SQL editor to give them roles and balances:

```sql
-- Replace with real UUIDs from auth.users after registering
UPDATE profiles SET role = 'ADMIN' WHERE id = '<your-admin-uuid>';
UPDATE wallets  SET balance = 500   WHERE user_id = '<your-test-uuid>';
```

---

## How it works

### Price engine (`server/priceEngine.ts`)
- 6 assets: EUR/USD, GBP/USD, BTC/USD, ETH/USD, GOLD, OIL
- Tick every 800ms using a Gaussian random walk with a slowly drifting trend bias
- Trend direction flips randomly every 50–150 ticks
- Price clamped to 30%–300% of base price
- OHLC candle built every 30 ticks
- Last 500 ticks stored per asset in Upstash Redis
- New WebSocket client immediately receives 500-tick snapshot for instant chart render

### Trade settlement (`server/settlementWorker.ts`)
- When `POST /api/trades` succeeds it pushes a `{tradeId, expiresAt}` job to Upstash Redis
- The WS server polls the queue every 500ms and schedules a `setTimeout` for each job
- At expiry: compare exit price vs entry price → WON (×1.82) / LOST (no credit) / DRAW (full refund)
- Settlement result is emitted via `EventEmitter` → WS server forwards to user's live connection

### Settlement recovery
- On WS server boot, all `OPEN` trades in Supabase are re-fetched and their timeouts rescheduled

---

## Payments

Not implemented. The wallet deposit button credits the real balance directly. To add Mobile Money or card payments, tell me which provider (MTN MoMo, Vodafone Cash, Paystack, Flutterwave) and I will wire it in.

---

## Environment variables

| Variable | Description |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon (public) key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (never expose to browser) |
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST endpoint |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `NEXT_PUBLIC_WS_URL` | WebSocket server URL seen by browser |
| `PORT` | WS server port (default 3001) |
