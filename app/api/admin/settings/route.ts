import { NextRequest } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { ok, handleError } from "@/lib/http";
import { getPaymentSettings, updatePaymentSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin(req);
    const settings = await getPaymentSettings();
    return ok({ settings });
  } catch (e) {
    return handleError(e);
  }
}

const Schema = z.object({
  paymentLink:         z.string().max(500).optional(),
  depositInstructions: z.string().max(1000).optional(),
});

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin(req);
    const patch = Schema.parse(await req.json());
    const settings = await updatePaymentSettings(patch);
    return ok({ settings });
  } catch (e) {
    return handleError(e);
  }
}
