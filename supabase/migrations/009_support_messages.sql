-- User → admin messaging. A signed-in user can send a free-text message
-- (e.g. a support question or complaint); it lands in the admin dashboard.
-- Email/name are denormalised at write time so the admin can read the thread
-- even if the profile changes later.

CREATE TABLE IF NOT EXISTS support_messages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES profiles(id),
  email       text,
  name        text,
  body        text NOT NULL,
  status      text NOT NULL DEFAULT 'OPEN'
                CHECK (status IN ('OPEN', 'READ', 'RESOLVED')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

-- Admin inbox ordering + unread filtering.
CREATE INDEX IF NOT EXISTS support_messages_status_idx
  ON support_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS support_messages_user_idx
  ON support_messages (user_id, created_at DESC);
