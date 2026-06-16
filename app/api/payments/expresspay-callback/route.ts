import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { queryPayment } from "@/lib/expresspay";
import { creditDepositWallet, failDeposit } from "@/lib/depositCredit";

export const runtime = "nodejs";

const APP_URL = process.env.EXPRESSPAY_APP_URL || "https://skyvult.com";

/** Browser redirect from ExpressPay after the user completes (or abandons) payment.
 *  ExpressPay sends: GET /api/payments/expresspay-callback?order-id=xxx&token=xxx
 *  We query ExpressPay to confirm the result, credit/fail the payment, then
 *  redirect the user back to the wallet page with a status indicator. */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const orderId = searchParams.get("order-id");
  const token   = searchParams.get("token");

  if (!orderId || !token) {
    return NextResponse.redirect(`${APP_URL}/wallet?deposit=failed&reason=Invalid+callback`);
  }

  try {
    const { data: pay } = await supabaseAdmin
      .from("payments")
      .select("id, user_id, amount, status, provider_reference, mobile_provider, mobile_number")
      .eq("provider_reference", orderId)
      .eq("provider", "expresspay")
      .single();

    if (!pay) {
      return NextResponse.redirect(`${APP_URL}/wallet?deposit=failed&reason=Payment+not+found`);
    }

    const q = await queryPayment(token);

    if (q.result === 1) {
      const cedis = q.amount != null ? Number(q.amount) : Number(pay.amount);
      await creditDepositWallet(pay, cedis);
      return NextResponse.redirect(`${APP_URL}/wallet?deposit=success`);
    }

    if (q.result === 4) {
      // MoMo payments can take minutes — post-url will credit when it completes.
      return NextResponse.redirect(`${APP_URL}/wallet?deposit=pending`);
    }

    const reason = q["result-text"] || "Payment was declined";
    await failDeposit(pay, reason);
    return NextResponse.redirect(
      `${APP_URL}/wallet?deposit=failed&reason=${encodeURIComponent(reason)}`
    );
  } catch (e) {
    console.error("[expresspay-callback]", e);
    return NextResponse.redirect(`${APP_URL}/wallet?deposit=pending`);
  }
}
