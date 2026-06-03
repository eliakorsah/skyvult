import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase, supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const Schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: NextRequest) {
  try {
    const body = Schema.parse(await req.json());

    // Rate limit: 8 login attempts per minute per IP+email combo
    const rl = await checkLimit(req, "login", 8, 60, body.email.toLowerCase());
    if (!rl.success) return fail(429, "Too many login attempts. Try again later.");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });
    if (error || !data.session) return fail(401, "Invalid credentials");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("name, role, blocked")
      .eq("id", data.user.id)
      .single();

    if (!profile || profile.blocked) return fail(401, "Account is disabled");

    return ok({
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      user: {
        id: data.user.id,
        name: profile.name,
        email: data.user.email,
        role: profile.role,
      },
    });
  } catch (e) {
    return handleError(e);
  }
}
