import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

// Admin payout console RPCs. These are MANUAL bookkeeping — no bank/PSP API moves
// money; the RPCs only record the ledger + mark rows paid (advisory-locked
// generation prevents double payout).

/** Generate payouts for a period; returns how many payout rows were created. */
export async function adminGeneratePayouts(db: Db, startISO: string, endISO: string): Promise<number> {
  const { data, error } = await db.rpc("admin_generate_payouts", { p_start: startISO, p_end: endISO });
  if (error) throw new RpcError(error);
  return typeof data === "number" ? data : Number(data ?? 0);
}

/** Mark a pending payout as paid (records that you settled it out-of-band). */
export async function adminMarkPayoutPaid(db: Db, payoutId: string): Promise<void> {
  const { error } = await db.rpc("admin_mark_payout_paid", { p_payout_id: payoutId });
  if (error) throw new RpcError(error);
}
