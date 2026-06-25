-- Referral bonus wagering lock.
--   bonus_locked        — ₵ of credited referral bonus that is NOT yet
--                         withdrawable. Reduces a user's withdrawable balance.
--   wagering_remaining  — ₵ of real-money trade volume the user must still
--                         place before the locked bonus is released.
-- When wagering_remaining reaches 0, bonus_locked is set to 0 (released).

alter table wallets
  add column if not exists bonus_locked       numeric(12,2) not null default 0,
  add column if not exists wagering_remaining numeric(12,2) not null default 0;
