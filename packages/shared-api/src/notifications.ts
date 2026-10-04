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

/**
 * Native app (Expo) registers its push token for the signed-in user. Idempotent
 * (call on every launch — refreshes last_seen_at); a token already held by
 * another user MOVES to the caller (phone changed hands). RPC-only by design:
 * device_push_tokens has no client insert/update policy.
 */
export async function registerDevicePushToken(db: Db, token: string, platform: "ios" | "android"): Promise<void> {
  const { error } = await db.rpc("register_device_push_token", { p_token: token, p_platform: platform });
  if (error) throw new RpcError(error);
}
