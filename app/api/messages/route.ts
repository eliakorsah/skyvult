import { NextRequest } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";
import { checkLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";

const SendSchema = z.object({
  body: z.string().trim().min(2).max(2000),
});

// GET — the signed-in user's own message history (newest first).
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { data } = await supabaseAdmin
      .from("support_messages")
      .select("id, body, status, created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);

    return ok({
      messages: (data ?? []).map((m: any) => ({
        id:        m.id,
        body:      m.body,
        status:    m.status,
        createdAt: m.created_at,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}

// POST — send a new message to the admins.
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser(req);
    const { body } = SendSchema.parse(await req.json());

    // 5 messages per 10 min per user — enough for a back-and-forth, stops spam.
    const rl = await checkLimit(req, "message", 5, 600, user.id);
    if (!rl.success) return fail(429, "You're sending messages too fast. Please wait a moment.");

    const { error } = await supabaseAdmin.from("support_messages").insert({
      user_id: user.id,
      email:   user.email,
      name:    user.name,
      body,
    });
    if (error) {
      console.error("[messages] insert error:", error.message);
      return fail(500, "Could not send your message. Please try again.");
    }

    return ok({ status: "SENT" });
  } catch (e) {
    return handleError(e);
  }
}
