-- Attach the MoMo number (registered under the user's legal name) to the
-- KYC submission. Once approved, the verified number is copied to the profile
-- and used automatically for all future withdrawals — no re-entry needed.

ALTER TABLE kyc_submissions
  ADD COLUMN IF NOT EXISTS mobile_number   text,
  ADD COLUMN IF NOT EXISTS mobile_provider text
    CHECK (mobile_provider IN ('MTN', 'TELECEL', 'AIRTELTIGO'));

-- Verified mobile stored on the profile after KYC approval.
-- Withdrawal route reads these instead of accepting phone from the request.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS verified_mobile_number   text,
  ADD COLUMN IF NOT EXISTS verified_mobile_provider text
    CHECK (verified_mobile_provider IN ('MTN', 'TELECEL', 'AIRTELTIGO'));
