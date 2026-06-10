import { NextRequest, NextResponse } from "next/server";
import { finalizeMtnDeposit } from "@/lib/mtnFinalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** MTN MoMo collection callback (set as X-Callback-Url on the request-to-pay).
 *
 *  MTN's callback is NOT signed like Korapay's, so we do NOT trust its body to
 *  move money. We only read the transaction reference from it and hand off to
 *  finalizeMtnDeposit(), which RE-VERIFIES the status with MTN's own API before
 *  crediting. A spoofed callback therefore can't credit anything — at worst it
 *  triggers a harmless status check.
 *
 *  Always returns 200 so MTN doesn't retry-storm us.
 */
export async function POST(req: NextRequest) {
  try {
    const headerRef = req.headers.get("x-reference-id");
    let bodyRef: string | undefined;
    try {
      const body = await req.json();
      bodyRef = body?.referenceId ?? body?.externalId ?? body?.reference;
    } catch {
      /* empty/non-JSON body — fine, header ref may still be present */
    }

    const referenceId = headerRef || bodyRef;
    if (referenceId) {
      await finalizeMtnDeposit(referenceId);
    } else {
      console.warn("[mtn-callback] no reference id in callback");
    }
  } catch (err: any) {
    console.error("[mtn-callback] handler crashed:", err?.message);
  }
  return NextResponse.json({ ok: true });
}
