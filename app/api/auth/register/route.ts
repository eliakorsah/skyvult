import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { provisionUser } from "@/lib/provision";

export const runtime = "nodejs";

const Schema = z.object({
  name: z.string().min(1).max(80),
  email: z.string().email(),
  password: z.string().min(8).max(200),
  // Optional invite code (case-insensitive). If present and resolves to an
  // existing user, that user becomes the referrer for this account.
  referralCode: z.string().trim().max(32).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json());

    // Rate limit: 5 registrations per hour per IP
    const rl = await checkLimit(req, "register", 5, 3600);
    if (!rl.success) return fail(429, "Too many sign-ups from this network. Try again later.");

    // Use admin API so email confirmation is bypassed (email_confirm: true)
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: body.email,
      password: body.password,
      email_confirm: true,
    });
    if (error) return fail(400, error.message);
    if (!data.user) return fail(400, "Registration failed");

    const uid = data.user.id;

    try {
      await provisionUser({ userId: uid, email: body.email, name: body.name, referralCode: body.referralCode });
    } catch (e: any) {
      // Roll back the auth user so the email can be retried cleanly.
      try { await supabaseAdmin.auth.admin.deleteUser(uid); } catch {}
      return fail(400, e?.message ?? "Could not create account");
    }

    const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (signInErr || !session.session) return fail(400, "Account created — please sign in.");

    return ok({
      accessToken: session.session.access_token,
      refreshToken: session.session.refresh_token,
      user: { id: uid, name: body.name, email: body.email, role: "USER" },
    });
  } catch (e) {
    return handleError(e);
  }
}
