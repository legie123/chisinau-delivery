import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUser } from "@/lib/push/send";

// Constant-time secret comparison — avoids leaking the drain secret via response
// timing (audit #66). Length-guarded because timingSafeEqual throws on length mismatch.
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

// Drains the notification_outbox: sends any pending Web Push, marks rows handled.
// Called every ~10s by the pg_cron `drain-push-outbox` job (via pg_net) — that's
// what delivers DB-originated notifications (dispatch-offer cascade waves, new
// orders) that no request thread is around to send. Guarded by a shared secret.
// web-push needs Node; force dynamic so it never gets statically cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BATCH = 50;
const MAX_ATTEMPTS = 5;

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

  const { data: rows, error } = await admin
    .from("notification_outbox")
    .select("id, user_id, title, body, url, tag, attempts")
    .is("sent_at", null)
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: true })
    .limit(BATCH);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) return NextResponse.json({ drained: 0 });

  const now = new Date().toISOString();
  let drained = 0;
  await Promise.allSettled(
    rows.map(async (r) => {
      // sendPushToUser is best-effort (never throws; prunes dead endpoints). A
      // user with no subscriptions is legitimately "done" — mark handled either
      // way so we don't reprocess. attempts is a safety net for the rare throw.
      await sendPushToUser(r.user_id, {
        title: r.title,
        body: r.body,
        url: r.url,
        tag: r.tag ?? undefined,
      });
      await admin
        .from("notification_outbox")
        .update({ sent_at: now, attempts: (r.attempts ?? 0) + 1 })
        .eq("id", r.id);
      drained++;
    }),
  );

  return NextResponse.json({ drained });
}
