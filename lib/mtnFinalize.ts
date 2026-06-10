import { supabaseAdmin } from "./supabase";
import { getCollectionStatus } from "./mtnmomo";
import { creditDepositWallet, failDeposit } from "./depositCredit";

/** Resolve a PENDING MTN deposit by asking MTN for the authoritative status,
 *  then crediting or failing it idempotently. This is the ONLY thing that
 *  credits MTN deposits — both the status poll and the MTN callback route call
 *  it. Because we re-verify with MTN before crediting, an unauthenticated /
 *  spoofed callback can't move money: it only triggers a server-side check.
 *
 *  Returns the resolved status so the status route can surface it to the UI.
 */
export async function finalizeMtnDeposit(referenceId: string): Promise<"SUCCESS" | "FAILED" | "PENDING"> {
  const { data: pay } = await supabaseAdmin
    .from("payments")
    .select("*")
    .eq("provider_reference", referenceId)
    .eq("provider", "mtn")
    .single();
  if (!pay) return "PENDING";
  if (pay.status === "SUCCESS") return "SUCCESS";
  if (pay.status === "FAILED")  return "FAILED";

  let result;
  try {
    result = await getCollectionStatus(referenceId);
  } catch {
    return "PENDING"; // transient — leave it for the next poll/callback
  }

  if (result.status === "SUCCESSFUL") {
    // Trust the amount we recorded on the row; MTN's reported amount is a
    // cross-check only. (Both are in cedis.)
    const cedis = Number(pay.amount);
    await creditDepositWallet(pay, cedis);
    return "SUCCESS";
  }
  if (result.status === "FAILED") {
    await failDeposit(pay, result.reason ?? "MTN declined the payment");
    return "FAILED";
  }
  return "PENDING";
}
