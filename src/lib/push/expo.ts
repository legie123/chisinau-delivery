import type { SupabaseClient } from "@supabase/supabase-js";
import type { PushPayload, PushSendOptions } from "@/lib/push/send";

// Native fan-out for the notification outbox: the Expo apps (courier/client)
// register Expo push tokens in device_push_tokens (migration 20261003002000);
// this sends the SAME outbox row to every token of the target user through the
// Expo push API. Plain fetch — no SDK dependency.
//
// Contract with the drain route: a transport failure (network / non-2xx)
// THROWS, so the outbox row is retried (attempts < 5). For a backgrounded
// courier this push is the only channel an offer has. Per-token errors do not
// throw; DeviceNotRegistered tokens (app uninstalled, token rotated) are pruned.
export const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
// One token per request: one account can hold tokens of BOTH apps (courier and
// client are different Expo projects), and Expo answers a request that mixes
// projects with a 400 PUSH_TOO_MANY_EXPERIENCE_IDS — the whole row then failed
// 5x and no native push was ever delivered.
// ponytail: per-token requests (users hold 1-3 tokens); store the app per token if that grows.
const EXPO_BATCH = 1;

type ExpoTicket =
  | { status: "ok"; id: string }
  | { status: "error"; message?: string; details?: { error?: string } };

// Android 8+ only shows a notification on a channel the app created; the
// courier app creates both ("offers" with max importance for the 30s offer).
function channelFor(tag: string | undefined): string {
  return tag?.startsWith("offer:") ? "offers" : "default";
}

export async function sendExpoPushToUser(
  admin: SupabaseClient,
  userId: string,
  payload: PushPayload,
  options?: PushSendOptions,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: number; pruned: number }> {
  const { data, error } = await admin.from("device_push_tokens").select("expo_token").eq("user_id", userId);
  if (error) throw new Error(`device_push_tokens read failed: ${error.message}`);
  const tokens = ((data ?? []) as { expo_token: string }[]).map((r) => r.expo_token);
  if (tokens.length === 0) return { sent: 0, pruned: 0 };

  const headers: Record<string, string> = {
    Accept: "application/json",
    "Accept-Encoding": "gzip, deflate",
    "Content-Type": "application/json",
  };
  // Only needed if "enhanced push security" is turned on for the Expo project.
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;

  const dead: string[] = [];
  let sent = 0;
  for (let i = 0; i < tokens.length; i += EXPO_BATCH) {
    const chunk = tokens.slice(i, i + EXPO_BATCH);
    const messages = chunk.map((to) => ({
      to,
      title: payload.title,
      body: payload.body,
      data: { url: payload.url ?? "/", tag: payload.tag ?? null },
      sound: "default",
      priority: options?.urgency === "high" ? "high" : "normal",
      channelId: channelFor(payload.tag),
      ...(options?.TTL != null ? { ttl: options.TTL } : {}),
    }));

    const res = await fetchImpl(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) });
    if (!res.ok) throw new Error(`expo push HTTP ${res.status}`);
    const json = (await res.json()) as { data?: ExpoTicket[] };
    (json.data ?? []).forEach((ticket, idx) => {
      if (ticket.status === "ok") sent += 1;
      else if (ticket.details?.error === "DeviceNotRegistered" && chunk[idx]) dead.push(chunk[idx]);
    });
  }

  if (dead.length > 0) {
    await admin.from("device_push_tokens").delete().in("expo_token", dead);
  }
  return { sent, pruned: dead.length };
}
