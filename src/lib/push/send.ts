import "server-only";
import webpush from "web-push";
import { createAdminClient } from "@/lib/supabase/admin";

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

let configured = false;
function configure(): boolean {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) return false;
  if (!configured) {
    webpush.setVapidDetails(subject, pub, priv);
    configured = true;
  }
  return true;
}

// Fire-and-forget push to every subscription a user has registered. Reads
// subscriptions with the service-role client (RLS-bypassing) because a sender
// acts on behalf of a DIFFERENT user than the recipient. Prunes dead endpoints.
// Fully best-effort: any failure is swallowed so it never breaks the caller.
export async function sendPushToUser(userId: string, payload: PushPayload): Promise<void> {
  try {
    if (!userId || !configure()) return;
    const admin = createAdminClient();
    const { data: subs } = await admin.from("push_subscriptions").select("*").eq("user_id", userId);
    if (!subs?.length) return;

    await Promise.allSettled(
      subs.map(async (s: { endpoint: string; p256dh: string; auth: string }) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
          );
        } catch (err) {
          const code = (err as { statusCode?: number })?.statusCode;
          if (code === 404 || code === 410) {
            await admin.from("push_subscriptions").delete().eq("endpoint", s.endpoint);
          }
        }
      }),
    );
  } catch {
    // never let a notification failure surface to the user flow
  }
}
