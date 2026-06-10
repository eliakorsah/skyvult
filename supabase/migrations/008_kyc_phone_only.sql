-- Simplify KYC to phone number + Ghana Card photo only.
-- We no longer collect the Ghana Card NUMBER or date of birth at submission
-- time, so relax those NOT NULL constraints. id_type defaults to GHANA_CARD.
-- The phone number is stored in mobile_number (added in 006) and its network
-- is auto-detected from the prefix; both are copied to the profile on approval
-- and used for withdrawals.

ALTER TABLE kyc_submissions
  ALTER COLUMN id_number     DROP NOT NULL,
  ALTER COLUMN date_of_birth DROP NOT NULL,
  ALTER COLUMN id_type       SET DEFAULT 'GHANA_CARD';

-- Name registered on the mobile money account. Collected so admins can match
-- it against the Ghana Card photo before approving. Copied to the profile on
-- approval and used as the recipient name for withdrawals.
ALTER TABLE kyc_submissions
  ADD COLUMN IF NOT EXISTS mobile_name text;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS verified_mobile_name text;
