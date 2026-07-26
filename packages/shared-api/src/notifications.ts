import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;
type Fns = Database["public"]["Functions"];

/**
 * Atomically claim a batch of pending notification-outbox rows for delivery
 * (called by the push-drain route, running as the service role). The claim RPC
 * marks the rows in-flight so concurrent drains don't double-send.
 */
export async function claimNotificationOutbox(
  db: Db,
  batch: number,
): Promise<Fns["claim_notification_outbox"]["Returns"]> {
  const { data, error } = await db.rpc("claim_notification_outbox", { p_batch: batch });
  if (error) throw new RpcError(error);
  return data ?? [];
}
