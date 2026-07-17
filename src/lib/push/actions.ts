"use server";

import { requireUser } from "@/lib/auth/require";

export type ActionResult = { error: string | null };

// Persist a browser push subscription for the signed-in user (upsert on endpoint).
export async function savePushSubscription(sub: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}): Promise<ActionResult> {
  let supabase, user;
  try {
    ({ supabase, user } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  const { error } = await supabase
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.id,
        endpoint: sub.endpoint,
        p256dh: sub.p256dh,
        auth: sub.auth,
        user_agent: sub.userAgent ?? null,
      },
      { onConflict: "endpoint" },
    );
  if (error) return { error: error.message };
  return { error: null };
}

export async function removePushSubscription(endpoint: string): Promise<ActionResult> {
  let supabase;
  try {
    ({ supabase } = await requireUser());
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Neautentificat." };
  }
  const { error } = await supabase.from("push_subscriptions").delete().eq("endpoint", endpoint);
  if (error) return { error: error.message };
  return { error: null };
}
