import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { supabaseAdmin } from "@/lib/supabase";
import { ok, fail, handleError } from "@/lib/http";

export const runtime = "nodejs";

const Schema = z.object({
  action: z.enum(["read", "resolve", "reopen"]),
});

export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    await requireAdmin(req);
    const { action } = Schema.parse(await req.json());
    const { id } = params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
      return fail(400, "Invalid ID");

    const update =
      action === "resolve"
        ? { status: "RESOLVED", resolved_at: new Date().toISOString() }
        : action === "reopen"
        ? { status: "OPEN", resolved_at: null }
        : { status: "READ" };

    const { error } = await supabaseAdmin
      .from("support_messages")
      .update(update)
      .eq("id", id);

    if (error) {
      console.error("[admin/messages] update error:", error.message);
      return fail(500, "Could not update the message.");
    }

    return ok({ status: update.status });
  } catch (e) {
    return handleError(e);
  }
}
