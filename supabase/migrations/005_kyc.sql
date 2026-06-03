-- KYC (Know Your Customer) identity verification.
-- One submission per user; re-submission is allowed after a REJECTED decision.
-- Admin reviews via the admin panel and sets status to APPROVED or REJECTED.

-- Track verification status on the profile for quick lookups.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'NONE'
    CHECK (kyc_status IN ('NONE', 'PENDING', 'APPROVED', 'REJECTED'));

CREATE TABLE IF NOT EXISTS kyc_submissions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid NOT NULL REFERENCES profiles(id),
  status         text NOT NULL DEFAULT 'PENDING'
                   CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
  full_name      text NOT NULL,
  date_of_birth  date NOT NULL,
  id_type        text NOT NULL CHECK (id_type IN ('GHANA_CARD', 'PASSPORT', 'DRIVERS_LICENSE')),
  id_number      text NOT NULL,
  -- Supabase Storage paths (private bucket: kyc-docs)
  front_path     text NOT NULL,
  back_path      text,
  selfie_path    text,
  rejection_reason text,
  submitted_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz
);

-- At most one PENDING or APPROVED submission per user at a time.
-- REJECTED submissions are kept for audit; re-submission creates a new row.
CREATE UNIQUE INDEX IF NOT EXISTS kyc_active_per_user
  ON kyc_submissions (user_id)
  WHERE status IN ('PENDING', 'APPROVED');

CREATE INDEX IF NOT EXISTS kyc_status_idx ON kyc_submissions (status, submitted_at DESC);

-- NOTE: Create a private Supabase Storage bucket named "kyc-docs" in your
-- Supabase dashboard. No public access — admin views via signed URLs only.
