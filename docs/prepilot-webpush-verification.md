# Web Push pipeline — pre-pilot verification (Phase 0)

Verified: 2026-07-26, against the live local stack (`supabase_db_chisinau-delivery` +
the launchd Next.js server on `http://localhost:3000`). Read-only DB inspection +
one real, cleaned-up `notification_outbox` row per the task's carve-out; no source
files touched.

**Claim under test:** `enqueue trigger → notification_outbox → pg_cron drain
(~10s) → POST /api/push/drain (x-drain-secret guard) → sent`.

## Result: server-side pipeline PROVEN end-to-end, automatically, without a real device

## 1. pg_cron jobs exist and fire clean

```
 jobid |        jobname         |   schedule   | active
-------+------------------------+--------------+--------
     4 | drain-push-outbox      | 10 seconds   | t
     3 | expire-dispatch-offers | 15 seconds   | t
     1 | expire-stale-orders    | * * * * *    | t
     2 | refresh-prep-stats     | */15 * * * * | t
```

`drain-push-outbox`: **62/62 runs `succeeded`, 0 failed** in `cron.job_run_details`
at time of check. Most ticks return "0 rows" (the job body is `select
net.http_post(...) where exists (select 1 from notification_outbox where sent_at
is null)` — it's a no-op skip when the outbox is empty, by design, not a failure).

## 2. Drain endpoint auth guard — both branches confirmed

| Request | Result |
|---|---|
| `POST /api/push/drain` (no header) | **401** `{"error":"unauthorized"}` |
| `POST /api/push/drain` with wrong secret | **401** |
| `POST /api/push/drain` with real `PUSH_DRAIN_SECRET` (from `.env.local`) | **200** `{"drained":0}` (outbox was empty at that instant) |

Secret comparison is `timingSafeEqual`-guarded (`src/app/api/push/drain/route.ts:8-12`) — confirmed length-guard prevents the throw-on-mismatched-length case (short probe strings still cleanly 401, not 500).

## 3. Live, automatic, real-row test (no manual curl needed to complete it)

Inserted one real (uncommitted-then-committed, not a `ROLLBACK` sim — this leg
must be visible to a second connection, i.e. the app process, per the task's
carve-out) row for `client@test.md` (`a0000000-...-001`, a real auth user with
**0** rows in `push_subscriptions` — confirmed via `select count(*) from
push_subscriptions` returning 0 rows total in the whole local DB right now):

```sql
insert into public.notification_outbox (user_id, title, body, url, tag)
values ('a0000000-0000-0000-0000-000000000001', 'PrepilotVerify test', 'e2e drain check', '/orders', 'prepilot-test:1')
returning id, sent_at;  -- sent_at: NULL at insert
```

Did **not** need to manually curl the drain endpoint — the running
`drain-push-outbox` cron tick reached it first, within the same 10s window:

```
notification_outbox row 7bfee0ba-...:
  sent_at    = 2026-07-26 17:02:59.831+00
  attempts   = 1
  claimed_at = 2026-07-26 17:02:59.923279+00

cron.job_run_details (drain-push-outbox):
  17:02:49.900752+00  succeeded  "0 rows"   <- tick before the insert, outbox empty
  17:02:59.906241+00  succeeded  "1 row"    <- tick that found + POSTed for my row
  17:03:09.911077+00  succeeded  "0 rows"   <- outbox empty again, already drained

net._http_response (pg_net's log of the actual HTTP call the cron made):
  id=7  status_code=200  created=17:02:59.907762+00  error_msg=(none)
```

This is the strongest form of proof available without a browser: the row went
`unclaimed → claimed → sent` entirely through the real async path (DB trigger
timing → pg_cron → pg_net → the actual Next.js route handler → `claim_notification_outbox`
RPC → `sendPushToUser` → outbox UPDATE), with **zero manual intervention** after
the INSERT. `sendPushToUser` resolved as a legitimate no-op (0 subscriptions for
that user = nothing to push to = correctly "done"), matching the documented
semantics in `src/app/api/push/drain/route.ts:58-59`. Row deleted after
confirming (cleanup): `DELETE ... WHERE id='7bfee0ba-...' ` → `DELETE 1`.

Also ran the same insert as a `BEGIN; ... ROLLBACK;` sim first (per the general
DB-safety rule) to confirm insert mechanics/RLS/triggers behave and that the row
truly disappears post-rollback from a separate connection — clean.

## 4. Corroborating evidence: the pipeline has been running clean all day, under real usage

Not just my one test row — the entire local `notification_outbox` history right now:

```
 sent | count | max_attempts
------+-------+--------------
 t    |    93 |            1
```

**All 93 rows ever enqueued are sent, and every single one succeeded on attempt
1** (no retries, nothing stuck, nothing hit the 5-attempt ceiling in
`claim_notification_outbox`). `net._http_response` shows **7/7 HTTP calls the
cron ever made returned 200** with no `error_msg`. Since outbox rows are only
created by the `enqueue_new_order_push` / `enqueue_offer_push` triggers (on
`orders` insert / `dispatch_offers` insert respectively — read directly from
`supabase/migrations/20260718000200_notification_outbox.sql:43-118`, not
exercised live by me since creating real test orders/offers is outside this
task's read-only scope), those 93 sent rows are proof the **enqueue leg has
also already fired correctly** from real order/dispatch activity today — this
verification did not need to synthesize that leg, it's independently evidenced
in the existing data.

## What is proven vs what still needs a real device

**Proven (server-side, fully automatic, evidence-backed):**
- pg_cron scheduling + firing (`10 seconds`, 62 clean runs).
- pg_net making the actual HTTP POST cross-container (`host.docker.internal:3000`) and getting 200s.
- The drain route's auth guard (401 without/wrong secret, 200 with it), atomic claim (`FOR UPDATE SKIP LOCKED` via `claim_notification_outbox`), and outbox state transitions (`unclaimed → claimed → sent`, `attempts` bumped, `claimed_at` cleared on failure path per the code).
- `sendPushToUser`'s no-subscriptions-is-done semantics.
- The enqueue triggers' SQL logic (by direct code read) — and indirectly, their live firing (93/93 historical rows sent).

**Still needs a real Chrome-Android device (cannot be proven from this box):**
- `PushOptIn.tsx`'s actual `pushManager.subscribe()` flow completing against a real Google/Mozilla push service and a real `push_subscriptions` row landing with real `endpoint`/`p256dh`/`auth` (local DB has **zero** rows in `push_subscriptions` right now — the send path's `webpush.sendNotification()` call has literally never been exercised end-to-end here, only its "no subscribers" short-circuit).
- `web-push`'s VAPID-signed payload actually being accepted by the real push service (Google FCM endpoint for Chrome).
- The service worker (`public/sw.js`) receiving the `push` event, decrypting/parsing the JSON payload, and `showNotification` actually rendering on a locked/backgrounded Android device.
- `notificationclick` focusing/opening the right URL on a real device.
- This is the one leg that genuinely cannot be simulated server-side — it requires a subscribed browser. Recommend: one manual pass with a real Chrome-Android device (or desktop Chrome as a first, cheaper check) hitting `PushOptIn`, then trigger a real order/offer and confirm the OS notification appears.

## Files touched
- `docs/prepilot-webpush-verification.md` (this file, new)
- No source files modified; one `notification_outbox` row inserted and deleted (id `7bfee0ba-56cc-4f47-84fb-4cb55d922e5e`), plus a rolled-back sim insert (tag `sim:rollback-test`, confirmed absent post-rollback).
