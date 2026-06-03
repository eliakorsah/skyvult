-- Referral system. Each user gets a unique short code at signup that they
-- share. When a new user signs up using that code, `referred_by` is stamped
-- on their profile. The first time the referee makes a real-money deposit
-- ≥ MIN_DEPOSIT, the referrer is credited the referral bonus.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by uuid REFERENCES profiles(id),
  -- Flips to TRUE the moment the referrer payout fires, so we never double-pay
  -- for the same referee no matter how many times they deposit later.
  ADD COLUMN IF NOT EXISTS referral_bonus_paid boolean NOT NULL DEFAULT false;

-- Unique short-code per user. Case-insensitive ("SKY-ABC123" == "sky-abc123")
-- so shares pasted from WhatsApp work regardless of casing.
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_uniq
  ON profiles (lower(referral_code));

-- Backfill: give every existing profile a code so they can start sharing
-- immediately without waiting for a re-register.
UPDATE profiles
SET referral_code = 'SKY-' || upper(substring(md5(id::text || extract(epoch from now())) from 1 for 6))
WHERE referral_code IS NULL;
