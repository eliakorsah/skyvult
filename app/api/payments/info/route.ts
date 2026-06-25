import { NextRequest } from "next/server";
import { requireUser } from "@/lib/auth";
import { ok, handleError } from "@/lib/http";
import { getPaymentSettings } from "@/lib/settings";
import { RISK, DEPOSITS_ENABLED } from "@/lib/assets";

export const runtime = "nodejs";

/** Public (authenticated) payment details shown on the deposit screen before a
 *  user commits — the admin-configured payment link, MoMo number, and notes. */
export async function GET(req: NextRequest) {
  try {
    await requireUser(req);
    const s = await getPaymentSettings();
    return ok({
      depositsEnabled:     DEPOSITS_ENABLED,
      minDeposit:          RISK.MIN_DEPOSIT,
      paymentLink:         s.paymentLink,
      depositInstructions: s.depositInstructions,
    });
  } catch (e) {
    return handleError(e);
  }
}
