import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { verifyWebhookSignature } from "@/lib/paystack";
import { withLock } from "@/lib/mutex";
import { maybePayReferralBonus } from "@/lib/referral";

export const runtime = "nodejs";
// Webhook signature is HMAC-SHA512 over the raw bytes — Next caching would
// alter the body. Always run fresh.
export const dynamic = "force-dynamic";

/** Paystack webhook receiver. Verifies the signature against the RAW body,
 *  then resolves the matching `payments` row idempotently. Idempotent
 *  because Paystack retries on any non-2xx response.
 *
 *  Events we care about:
 *    - charge.success      → DEPOSIT succeeded; credit the wallet.
 *    - charge.failed       → DEPOSIT failed; mark FAILED (no wallet impact).
 *    - transfer.success    → WITHDRAWAL completed; mark SUCCESS.
 *    - transfer.failed     → WITHDRAWAL failed; REFUND the user (we
 *                            already debited optimistically).
 *    - transfer.reversed   → WITHDRAWAL reversed by Paystack later (rare
 *                            but real); also REFUND. */
export async function POST(req: NextRequest) {
  try {
    // Critical: signature is over the RAW body. text() preserves the exact
    // bytes Paystack signed. Parsing then re-stringifying would break the
    // hash by re-ordering JSON keys.
    const raw = await req.text();
    const sig = req.headers.get("x-paystack-signature");
    if (!verifyWebhookSignature(raw, sig)) {
      // Always return 200 even on bad signature so a probing attacker
      // gets no extra signal about which payloads were valid. We log it
      // for audit but don't act on the body.
      console.warn("[paystack-webhook] bad signature; ignoring");
      return NextResponse.json({ ok: true });
    }

    let payload: any;
    try { payload = JSON.parse(raw); } catch {
      return NextResponse.json({ ok: true });
    }

    const event: string = payload?.event ?? "";
    const data:  any    = payload?.data  ?? {};

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
    console.error("[paystack-webhook] handler crashed:", err?.message);
    // Returning 200 prevents Paystack's retry storm even when we hit a
    // transient error. The next event of the same kind will resolve it.
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
    console.warn("[paystack-webhook] charge for unknown reference:", reference);
    return;
  }
  if (pay.status !== "PENDING") return; // already resolved

  if (event === "charge.failed") {
    await supabaseAdmin
      .from("payments")
      .update({
        status: "FAILED",
        failure_reason: data?.gateway_response?.slice(0, 200) ?? "Provider declined",
        resolved_at: new Date().toISOString(),
      })
      .eq("id", pay.id)
      .eq("status", "PENDING");
    return;
  }

  // event === "charge.success" → credit the wallet.
  // Paystack returns amount in pesewas; trust it over our originally-
  // requested amount in case Paystack adjusted (rare for MoMo, common for
  // card payments with currency conversion).
  const cedis = Number(data?.amount) / 100;
  if (!isFinite(cedis) || cedis <= 0) return;

  await withLock(`wallet:${pay.user_id}`, async () => {
    // Optimistic-concurrency credit with retry — same pattern as the
    // settlement worker. Closes the race against the trade API also
    // mutating this user's wallet at the same instant.
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: wallet } = await supabaseAdmin
        .from("wallets")
        .select("balance")
        .eq("user_id", pay.user_id)
        .single();
      if (!wallet) return;
      const before = Number(wallet.balance);
      const after  = before + cedis;
      const { data: upd } = await supabaseAdmin
        .from("wallets")
        .update({ balance: after })
        .eq("user_id", pay.user_id)
        .eq("balance", before)
        .select("user_id");
      if (upd && upd.length > 0) {
        await supabaseAdmin.from("transactions").insert({
          user_id: pay.user_id,
          type:    "DEPOSIT",
          amount:  cedis,
          balance_before: before,
          balance_after:  after,
          reference: reference,
          is_demo: false,
        });
        // Mark the payments row resolved AFTER the credit lands.
        await supabaseAdmin
          .from("payments")
          .update({ status: "SUCCESS", resolved_at: new Date().toISOString() })
          .eq("id", pay.id)
          .eq("status", "PENDING");
        // Referral bonus check — fires only on the first qualifying deposit
        // for a user who has referred_by set. Idempotent + non-fatal.
        await maybePayReferralBonus(pay.user_id, cedis);
        return;
      }
    }
    console.error("[paystack-webhook] deposit credit failed after retries", reference);
  });
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
    console.error("[paystack-webhook] withdrawal refund failed after retries", reference);
  });
}
