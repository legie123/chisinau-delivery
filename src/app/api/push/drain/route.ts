import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { claimNotificationOutbox } from "@chisinau/shared-api";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push/send";
import { sendExpoPushToUser } from "@/lib/push/expo";

// Constant-time secret comparison — avoids leaking the drain secret via response
// timing (audit #66). Length-guarded because timingSafeEqual throws on length mismatch.
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Drains the notification_outbox: sends any pending Web Push + Expo (native) push, marks rows handled.
// Called every ~10s by the pg_cron `drain-push-outbox` job (via pg_net) — that's
// what delivers DB-originated notifications (dispatch-offer cascade waves, new
// orders) that no request thread is around to send. Guarded by a shared secret.
// web-push needs Node; force dynamic so it never gets statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 50;
// Max attempts (5) is enforced inside claim_notification_outbox itself.

// Push urgency/TTL by outbox tag: dispatch-offer pushes ('offer:' — the 30s-countdown
// courier offer, WS2) are time-critical so they go 'high'/TTL 40 (die with the offer,
// no point delivering a stale one); customer status pushes ('order-' — order status
// changed) are informational so they go 'normal'/TTL 600 (survive a longer offline gap).
// Any other tag keeps web-push's own defaults.
function pushOptionsForTag(tag: string | null): { urgency: "high" | "normal"; TTL: number } | undefined {
  if (!tag) return undefined;
  if (tag.startsWith("offer:")) return { urgency: "high", TTL: 40 };
  if (tag.startsWith("order-")) return { urgency: "normal", TTL: 600 };
  return undefined;
}

export async function POST(req: Request) {
  const secret = process.env.PUSH_DRAIN_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "drain not configured" }, { status: 503 });
  }
  if (!secretMatches(req.headers.get("x-drain-secret") ?? "", secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let admin;
  try {
    admin = createAdminClient();
  } catch {
    return NextResponse.json({ error: "service role unavailable" }, { status: 503 });
  }

  // Atomic claim (audit #45): the RPC marks rows claimed under FOR UPDATE SKIP
  // LOCKED, so overlapping cron ticks can never pick up the same row twice; a
  // crashed run's claims free themselves after the 60s reclaim window.
  type OutboxRow = { id: string; user_id: string; title: string; body: string; url: string; tag: string | null; attempts: number };
  let rows: OutboxRow[];
  try {
    const data = await claimNotificationOutbox(admin, BATCH);
    rows = (data ?? []) as OutboxRow[];
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "claim failed" }, { status: 500 });
  }

  if (!rows.length) return NextResponse.json({ drained: 0 });

  const now = new Date().toISOString();
  let drained = 0;
  let failed = 0;
  await Promise.allSettled(
    rows.map(async (r) => {
      const attempts = (r.attempts ?? 0) + 1;
      try {
        // sendPushToUser is best-effort (prunes dead endpoints, resolves for a user
        // with no subscriptions — legitimately "done"). If it DOES throw (audit
        // #5/#10/#16), bump attempts WITHOUT sent_at so the row is retried until
        // MAX_ATTEMPTS, then the claim RPC (attempts < 5) stops picking it up.
        // A 429 here is Chrome/FCM rate-limiting the push service, not an app bug.
        const payload = { title: r.title, body: r.body, url: r.url, tag: r.tag ?? undefined };
        // Web push only on the FIRST attempt: it never throws, so a row that comes back
        // for a retry has already sent it — the retry is for the native leg only.
        if (attempts === 1) await sendPushToUser(r.user_id, payload, pushOptionsForTag(r.tag));
        // Native apps (Expo tokens). Throws on a transport failure → the row is
        // retried like any other failed attempt.
        await sendExpoPushToUser(admin, r.user_id, payload, pushOptionsForTag(r.tag));
        await admin.from("notification_outbox").update({ sent_at: now, attempts }).eq("id", r.id);
        drained++;
      } catch {
        // record the failed attempt; clear claimed_at so it's eligible before the
        // 60s reclaim window would otherwise strand it.
        await admin.from("notification_outbox").update({ attempts, claimed_at: null }).eq("id", r.id);
        failed++;
      }
    }),
  );

  return NextResponse.json({ drained, failed });
}
