import { NextRequest } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { queryPayment } from "@/lib/expresspay";
import { creditDepositWallet, failDeposit } from "@/lib/depositCredit";

export const runtime = "nodejs";

/** Server-to-server callback from ExpressPay when a MoMo payment completes
 *  asynchronously (after the user has already left the payment page).
 *  ExpressPay POSTs: order-id + token (form-urlencoded).
 *  Must always return HTTP 200 — any other status causes ExpressPay to retry. */
export async function POST(req: NextRequest) {
  try {
    const text    = await req.text();
    const params  = new URLSearchParams(text);
    const orderId = params.get("order-id");
    const token   = params.get("token");

    if (!orderId || !token) return new Response("ok", { status: 200 });

    const { data: pay } = await supabaseAdmin
      .from("payments")
      .select("id, user_id, amount, status, provider_reference, mobile_provider, mobile_number")
      .eq("provider_reference", orderId)
      .eq("provider", "expresspay")
      .single();

    if (!pay) return new Response("ok", { status: 200 });

    const q = await queryPayment(token);

    if (q.result === 1) {
      const cedis = q.amount != null ? Number(q.amount) : Number(pay.amount);
      await creditDepositWallet(pay, cedis);
    } else if (q.result === 2) {
      await failDeposit(pay, q["result-text"] || "Payment declined");
    }
    // result 3 = system error, result 4 = still pending — do nothing, wait for next callback

    return new Response("ok", { status: 200 });
  } catch (e) {
    console.error("[expresspay-posturl]", e);
    return new Response("ok", { status: 200 }); // always 200 so ExpressPay doesn't retry on our errors
  }
}
