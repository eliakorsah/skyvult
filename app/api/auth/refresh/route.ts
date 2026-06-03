import { NextRequest } from "next/server";
import { z } from "zod";
import { supabase } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";

export const runtime = "nodejs";

const Schema = z.object({ refreshToken: z.string().min(1) });

export async function POST(req: NextRequest) {
  try {
    const { refreshToken } = Schema.parse(await req.json());
    const { data, error } = await supabase.auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session) return fail(401, "Invalid refresh token");
    return ok({ accessToken: data.session.access_token });
  } catch (e) {
    return handleError(e);
  }
}
