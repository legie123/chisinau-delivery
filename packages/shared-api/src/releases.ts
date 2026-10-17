import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

/**
 * Admin sets a NEW daily cap for courier order releases ("Renunț la comandă", 20261012000209).
 * courier_release_policy is versioned + immutable like the tariff: a new row from now(), never
 * an edit. platform_admin only (the RPC raises 'not authorized' otherwise); 0..20 is a DB check.
 */
export async function setCourierReleasePolicy(
  db: SupabaseClient<Database>,
  dailyCap: number,
  note?: string,
): Promise<void> {
  const { error } = await db.rpc("set_courier_release_policy", { p_daily_cap: dailyCap, p_note: note });
  if (error) throw new RpcError(error);
}
