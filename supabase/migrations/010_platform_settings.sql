-- Platform settings: simple key/value store editable from the admin panel.
-- Used today for the manual-deposit payment details (payment link, MoMo
-- number, instructions shown to users). One row per setting key.

create table if not exists platform_settings (
  key        text primary key,
  value      text not null default '',
  updated_at timestamptz not null default now()
);

-- Seed the payment keys so the admin form always has rows to edit.
insert into platform_settings (key, value) values
  ('payment_link',         ''),
  ('deposit_instructions', 'Pay using the link above, then keep your reference. Your balance is credited once we confirm receipt.')
on conflict (key) do nothing;
