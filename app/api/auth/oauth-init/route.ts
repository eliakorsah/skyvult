import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";
import { provisionUser } from "@/lib/provision";

export const runtime = "nodejs";

const Schema = z.object({
  accessToken:  z.string().min(10),
  referralCode: z.string().trim().max(32).optional(),
});

/** Called by the OAuth callback page after Supabase completes the Google /
 *  Facebook sign-in. Verifies the access token, then provisions the profile +
 *  wallet (idempotent — returning OAuth users skip straight through). */
export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json());

    const rl = await checkLimit(req, "oauth-init", 10, 3600);
    if (!rl.success) return fail(429, "Too many attempts. Try again later.");

    const { data: { user }, error } = await supabase.auth.getUser(body.accessToken);
    if (error || !user || !user.email) return fail(401, "Invalid session");

    // Derive a display name from OAuth metadata, falling back to the email handle.
    const meta = (user.user_metadata ?? {}) as Record<string, any>;
    const name =
      meta.full_name || meta.name || meta.user_name ||
      user.email.split("@")[0];

    const profile = await provisionUser({
      userId: user.id,
      email: user.email,
      name,
      referralCode: body.referralCode,
    });

    return ok({
      user: { id: user.id, name: profile.name, email: user.email, role: profile.role },
    });
  } catch (e) {
    return handleError(e);
  }
}
