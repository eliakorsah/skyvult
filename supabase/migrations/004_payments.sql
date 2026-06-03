-- Payments lifecycle: every real-money deposit AND withdrawal initiated via
-- Paystack (or any future provider) gets a row here, tracked end-to-end from
-- "user clicked Deposit/Withdraw" → "provider webhook resolved it".
--
-- Separate from `transactions` (the accounting ledger). A single payment
-- generates a transactions row only after the webhook confirms success —
-- until then the payment sits in PENDING with no wallet impact (deposits)
-- or wallet debited + waiting for transfer confirmation (withdrawals).

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id),
  type text NOT NULL CHECK (type IN ('DEPOSIT','WITHDRAWAL')),
  amount numeric(12,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','SUCCESS','FAILED','ABANDONED')),
  provider text NOT NULL DEFAULT 'paystack',
  -- Paystack's reference (deposits) or transfer_code (withdrawals).
  -- UNIQUE so webhook retries can't double-credit / double-debit.
  provider_reference text UNIQUE,
  mobile_provider text,
  mobile_number text,
  failure_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS payments_user_idx ON payments (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments (provider_reference);
CREATE INDEX IF NOT EXISTS payments_status_idx ON payments (status, created_at DESC);
