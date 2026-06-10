import { NextRequest } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, handleError } from "@/lib/http";

export const runtime = "nodejs";

// GET — support inbox. Defaults to non-resolved (OPEN + READ); pass
// ?status=RESOLVED to view the archive, or ?status=ALL for everything.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);

    const status = new URL(req.url).searchParams.get("status") ?? "INBOX";

    let query = supabaseAdmin
      .from("support_messages")
      .select("id, user_id, email, name, body, status, created_at, resolved_at")
      .order("created_at", { ascending: false })
      .limit(200);

    if (status === "RESOLVED")      query = query.eq("status", "RESOLVED");
    else if (status === "OPEN")     query = query.eq("status", "OPEN");
    else if (status !== "ALL")      query = query.in("status", ["OPEN", "READ"]); // INBOX

    const { data } = await query;

    const messages = (data ?? []).map((m: any) => ({
      id:         m.id,
      userId:     m.user_id,
      email:      m.email,
      name:       m.name,
      body:       m.body,
      status:     m.status,
      createdAt:  m.created_at,
      resolvedAt: m.resolved_at,
    }));

    const unread = messages.filter((m) => m.status === "OPEN").length;
    return ok({ messages, unread });
  } catch (e) {
    return handleError(e);
  }
}
