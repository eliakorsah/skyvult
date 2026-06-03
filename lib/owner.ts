// Owner-email helpers. SERVER-ONLY — do NOT import this file from a client
// component. `process.env.OWNER_EMAIL` has no NEXT_PUBLIC_ prefix, so on
// the client side it would resolve to undefined → isOwnerEmail() always
// returns false. The matching client-side admin gate uses `role === 'ADMIN'`
// from /api/auth/me instead, which is sufficient because the server still
// enforces both gates (role + email) inside requireAdmin().

export const OWNER_EMAIL: string = (process.env.OWNER_EMAIL ?? "").trim().toLowerCase();

if (!OWNER_EMAIL && typeof window === "undefined") {
  // Loud warning at server boot if the env var is missing — the platform
  // will start, but the admin panel will be inaccessible to everyone.
  // eslint-disable-next-line no-console
  console.warn("[owner] OWNER_EMAIL env var not set — admin panel is locked out until configured in .env.local");
}

export function isOwnerEmail(email?: string | null): boolean {
  if (!email || !OWNER_EMAIL) return false;
  return email.trim().toLowerCase() === OWNER_EMAIL;
}
