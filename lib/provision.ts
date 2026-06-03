import { supabaseAdmin } from "./supabase";
import { isOwnerEmail } from "./owner";

/** SKY-ABC123 style referral code — 6 hex chars after the prefix. */
function generateReferralCode(): string {
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0").toUpperCase();
  return `SKY-${hex}`;
}

/** Ensures a profile + wallet exist for a freshly-authenticated user.
 *  Idempotent — if the profile already exists it's a no-op and returns the
 *  existing row. Used by both password registration and OAuth (Google/Facebook)
 *  so every account is provisioned identically: own referral code, demo
 *  balance, optional referrer link, owner→ADMIN promotion.
 *
 *  Returns the resolved profile (name + role) so callers can echo it back. */
export async function provisionUser(opts: {
  userId: string;
  email: string;
  name: string;
  referralCode?: string | null;
}): Promise<{ name: string; role: "USER" | "ADMIN" }> {
  const { userId, email, name } = opts;

  // Already provisioned? Return existing.
  const { data: existing } = await supabaseAdmin
    .from("profiles")
    .select("name, role")
    .eq("id", userId)
    .maybeSingle();
  if (existing) return { name: existing.name, role: existing.role as "USER" | "ADMIN" };

  const role: "USER" | "ADMIN" = isOwnerEmail(email) ? "ADMIN" : "USER";

  // Resolve referrer if a code was provided (case-insensitive, self-ref blocked).
  let referredBy: string | null = null;
  if (opts.referralCode) {
    const { data: refRow } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("referral_code", opts.referralCode)
      .maybeSingle();
    if (refRow && refRow.id !== userId) referredBy = refRow.id as string;
  }

  // Generate a unique code with retry on the rare collision.
  let myCode = generateReferralCode();
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .ilike("referral_code", myCode)
      .maybeSingle();
    if (!clash) break;
    myCode = generateReferralCode();
  }

  const { error: profileErr } = await supabaseAdmin.from("profiles").insert({
    id: userId,
    name,
    role,
    blocked: false,
    referral_code: myCode,
    referred_by: referredBy,
  });
  if (profileErr) throw new Error(profileErr.message);

  const { error: walletErr } = await supabaseAdmin.from("wallets").insert({
    user_id: userId,
    balance: 0,
    demo_balance: 10_000,
  });
  if (walletErr) {
    // Roll back the profile so a retry can succeed cleanly.
    try { await supabaseAdmin.from("profiles").delete().eq("id", userId); } catch {}
    throw new Error(walletErr.message);
  }

  return { name, role };
}
