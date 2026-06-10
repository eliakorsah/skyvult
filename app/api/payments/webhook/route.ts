import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyWebhookSignature } from "@/lib/korapay";
import { withLock } from "@/lib/mutex";
import { creditDepositWallet, failDeposit } from "@/lib/depositCredit";

export const runtime = "nodejs";
// Webhook signature depends on the exact payload — Next caching would alter
// the body. Always run fresh.
export const dynamic = "force-dynamic";

/** Korapay webhook receiver. Korapay signs the JSON-stringified `data` object
 *  (HMAC-SHA256) in the `x-korapay-signature` header. We parse the body,
 *  verify the signature over `data`, then resolve the matching `payments` row
 *  idempotently (Korapay retries on any non-2xx response).
 *
 *  Events we care about:
 *    - charge.success      → DEPOSIT succeeded; credit the wallet.
 *    - charge.failed       → DEPOSIT failed; mark FAILED (no wallet impact).
 *    - transfer.success    → WITHDRAWAL completed; mark SUCCESS (only fires
 *                            if you later auto-disburse; manual flow ignores).
 *    - transfer.failed     → WITHDRAWAL failed; REFUND the user. */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.text();

    let payload: any;
    try { payload = JSON.parse(raw); } catch {
      return NextResponse.json({ ok: true });
    }

    const event: string = payload?.event ?? "";
    const data:  any    = payload?.data  ?? {};

    // Korapay signs the `data` object only (not the whole body), HMAC-SHA256.
    const sig = req.headers.get("x-korapay-signature");
    if (!verifyWebhookSignature(data, sig)) {
      // Always return 200 even on bad signature so a probing attacker gets no
      // extra signal about which payloads were valid. Log for audit only.
      console.warn("[korapay-webhook] bad signature; ignoring");
      return NextResponse.json({ ok: true });
    }

    if (event === "charge.success" || event === "charge.failed") {
      await handleChargeResult(event, data);
    } else if (event === "transfer.success") {
      await handleTransferResult(data, "SUCCESS");
    } else if (event === "transfer.failed" || event === "transfer.reversed") {
      await handleTransferResult(data, "FAILED");
    }
    // Any other event type: ack and ignore.

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error("[korapay-webhook] handler crashed:", err?.message);
    // Returning 200 prevents a retry storm even when we hit a transient
    // error. The next event of the same kind will resolve it.
    return NextResponse.json({ ok: true });
  }
}

// ─── Deposit (charge) resolution ────────────────────────────────────────

async function handleChargeResult(event: string, data: any): Promise<void> {
  const reference: string | undefined = data?.reference;
  if (!reference) return;

  // Look up the payment row by the reference we generated when initiating
  // the charge. If it's already resolved (idempotent re-delivery), bail.
  const { data: pay } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("provider_reference", reference)
    .single();
  if (!pay) {
    console.warn("[korapay-webhook] charge for unknown reference:", reference);
    return;
  }
  if (pay.status !== "PENDING") return; // already resolved

  if (event === "charge.failed") {
    await failDeposit(pay, data?.gateway_response ?? "Provider declined");
    return;
  }

  // event === "charge.success" → credit the wallet.
  // Korapay returns amount in MAJOR units (cedis) — no ÷100. Trust the
  // provider amount over our originally-requested amount. Fall back to the
  // amount we recorded on the payments row if the webhook omits it.
  const cedis = Number(data?.amount ?? pay.amount);
  await creditDepositWallet(pay, cedis);
}

// ─── Withdrawal (transfer) resolution ───────────────────────────────────

async function handleTransferResult(data: any, outcome: "SUCCESS" | "FAILED"): Promise<void> {
  // Withdrawals key off the `reference` we set on /transfer (same field
  // pattern as charges, so the lookup is uniform).
  const reference: string | undefined = data?.reference;
  if (!reference) return;

  const { data: pay } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("provider_reference", reference)
    .single();
  if (!pay) return;
  if (pay.status !== "PENDING") return;

  if (outcome === "SUCCESS") {
    // Wallet was already debited at withdrawal-initiation time. Nothing to
    // do to the balance — just mark the payment resolved.
    await supabaseAdmin
      .from("payments")
      .update({ status: "SUCCESS", resolved_at: new Date().toISOString() })
      .eq("id", pay.id)
      .eq("status", "PENDING");
    return;
  }

  // FAILED — refund the previously-debited amount as a +Δ with optimistic
  // concurrency (same pattern as the trade-refund path).
  const refund = Number(pay.amount);
  await withLock(`wallet:${pay.user_id}`, async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("balance")
        .eq("user_id", pay.user_id)
        .single();
      if (!wallet) return;
      const before = Number(wallet.balance);
      const after  = before + refund;
      const { data: upd } = await supabaseAdmin
        .from("wallets")
        .update({ balance: after })
        .eq("user_id", pay.user_id)
        .eq("balance", before)
        .select("user_id");
      if (upd && upd.length > 0) {
        await supabaseAdmin.from("transactions").insert({
          user_id: pay.user_id,
          type:    "WITHDRAWAL_REVERSAL",
          amount:  refund,
          balance_before: before,
          balance_after:  after,
          reference: reference,
          is_demo: false,
        });
        await supabaseAdmin
          .from("payments")
          .update({
            status: "FAILED",
            failure_reason: data?.failures?.[0]?.failure_reason
              ?? data?.gateway_response
              ?? "Transfer failed",
            resolved_at: new Date().toISOString(),
          })
          .eq("id", pay.id)
          .eq("status", "PENDING");
        return;
      }
    }
    console.error("[korapay-webhook] withdrawal refund failed after retries", reference);
  });
}
