-- ============================================================
-- SkyVult — run this ONCE in your Supabase SQL Editor
-- Dashboard → SQL Editor → New query → paste → Run
-- ============================================================

-- ── 001: Chart candles ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS chart_candles (
  asset  text             NOT NULL,
  time   bigint           NOT NULL,
  open   double precision NOT NULL,
  high   double precision NOT NULL,
  low    double precision NOT NULL,
  close  double precision NOT NULL,
  PRIMARY KEY (asset, time)
);
CREATE INDEX IF NOT EXISTS chart_candles_asset_time_desc ON chart_candles (asset, time DESC);
ALTER TABLE chart_candles DISABLE ROW LEVEL SECURITY;

-- ── 002: Trade TP/SL columns ─────────────────────────────────
ALTER TABLE trades
  ADD COLUMN IF NOT EXISTS tp_price   double precision,
  ADD COLUMN IF NOT EXISTS sl_price   double precision,
  ADD COLUMN IF NOT EXISTS entry_price double precision;

-- ── 003: Referrals ───────────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code       text,
  ADD COLUMN IF NOT EXISTS referred_by         uuid REFERENCES profiles(id),
  ADD COLUMN IF NOT EXISTS referral_bonus_paid boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_uniq
  ON profiles (lower(referral_code));

-- Backfill: every existing user gets a code
UPDATE profiles
SET referral_code = 'SKY-' || upper(substring(md5(id::text || extract(epoch from now())) from 1 for 6))
WHERE referral_code IS NULL;

-- ── 004: Payments ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES profiles(id),
  type               text NOT NULL CHECK (type IN ('DEPOSIT','WITHDRAWAL')),
  amount             numeric(12,2) NOT NULL CHECK (amount > 0),
  status             text NOT NULL DEFAULT 'PENDING'
                       CHECK (status IN ('PENDING','SUCCESS','FAILED','ABANDONED')),
  provider           text NOT NULL DEFAULT 'paystack',
  provider_reference text UNIQUE,
  mobile_provider    text,
  mobile_number      text,
  failure_reason     text,
  created_at         timestamptz NOT NULL DEFAULT now(),
  resolved_at        timestamptz
);
CREATE INDEX IF NOT EXISTS payments_user_idx        ON payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments (provider_reference);
CREATE INDEX IF NOT EXISTS payments_status_idx       ON payments (status, created_at DESC);

-- ── 005: KYC submissions ─────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'NONE'
    CHECK (kyc_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED'));

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL REFERENCES profiles(id),
  status           text NOT NULL DEFAULT 'PENDING'
                     CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  full_name        text NOT NULL,
  date_of_birth    date NOT NULL,
  id_type          text NOT NULL CHECK (id_type IN ('GHANA_CARD', 'PASSPORT', 'DRIVERS_LICENSE')),
  id_number        text NOT NULL,
  front_path       text NOT NULL,
  back_path        text,
  selfie_path      text,
  rejection_reason text,
  submitted_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at      timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS kyc_active_per_user
  ON kyc_submissions (user_id)
  WHERE status IN ('PENDING', 'APPROVED');

CREATE INDEX IF NOT EXISTS kyc_status_idx ON kyc_submissions (status, submitted_at DESC);

-- ── 006: KYC mobile money ────────────────────────────────────
ALTER TABLE kyc_submissions
  ADD COLUMN IF NOT EXISTS mobile_number   text,
  ADD COLUMN IF NOT EXISTS mobile_provider text
    CHECK (mobile_provider IN ('MTN', 'TELECEL', 'AIRTELTIGO'));

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS verified_mobile_number   text,
  ADD COLUMN IF NOT EXISTS verified_mobile_provider text
    CHECK (verified_mobile_provider IN ('MTN', 'TELECEL', 'AIRTELTIGO'));

-- ── 007: Free bonus flag ─────────────────────────────────────
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS free_bonus_claimed boolean NOT NULL DEFAULT false;

-- ============================================================
-- Done. The kyc-docs storage bucket is auto-created by the
-- app on the first KYC upload — no manual bucket setup needed.
-- ============================================================
