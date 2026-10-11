# Plan paritate Bolt Food — chisinau-delivery

Generat 2026-10-11 din workflow wf_77b732df-94a: gap map (4 agenti), research (4), dezbatere 3 lentile (opus/sonnet/fable) + red-team opus per plan, judecator opus, critic de completitudine. Clean-room: flows si UX, nimic Bolt in produs.

Gap map: {"partial": 51, "yes": 41, "no": 54, "skip": 11} din 157 randuri (replica/gap-map.csv cu dovezi).

## Rezumat

This is one plan, synthesized from all three lenses. Every repo claim below was re-checked on 2026-10-11, read-only.

**The diagnosis is correct and was re-checked in the repo (VERIFICAT).**
- The driver app shows fake pins. `mobile/driver/src/lib/api.ts:286-287` builds coordinates from sin/cos, and `ActiveDeliveryScreen.tsx:151` sets drop-off as +0.008, with a hardcoded 4.9 rating at :274. `Linking` is imported at :11 and never called.
- `dispatch_order` (live body in `20260813000400_cash_gate_fixes.sql`) uses a 10-minute GPS window, falls back to 6.0 km (:64), and hardcodes a 30 s offer (:91).
- The live sweeper body is `20261003001100_streak_only_when_available.sql`, not 20261002000200. It swallows errors at :85 and :98.
- The push drain URL defaults to `host.docker.internal` (`20260718000200`:128).
- `admin_generate_payouts` requires `has_role('platform_admin')`, so it cannot run from cron.
- `erase_customer_pii` has no app caller. It never touches `auth.users`, `addresses.contact_phone` or push tokens.
- The client pin is optional (`CartScreen`:345; `AddressesScreen`:113 sets `pin: null`). `fetchMenu` filters out unavailable items. The support number is a placeholder in three places, including the web `(customer)/layout.tsx:99`.
- `place_order` (`20261008000200`) never writes `order_items.notes` and hardcodes the 1400 MDL cash cap at :152.
- `order_type` only allows `standard` and `catering`.
- `entrance`, `floor` and `intercom_code` already exist on addresses (no migration needed).
- The only wake-lock is in `useBroadcastCourierLocation`.
- The driver is on Expo 54 / RN 0.81.5, the client on 57 / RN 0.86.3.
- `EAS_PROJECT_ID` is env-only, so there are no push tokens. No `google-services` file exists. The driver location text promises background use "only during an active delivery".
- SMTP is commented out in `supabase/config.toml`:237. There is no `.github/workflows`. `eas` and `adb` are absent; `xcodebuild`, `cloudflared` and `scripts/mobile/tunnel.sh` exist.
- 121 migrations, last sim is `tests/rpc/87`. New sims start at 88.

**Corrections to the critiques.**
- The repo HAS a git remote (`origin` github.com/legie123/chisinau-delivery). The claim of "no remote" was wrong. Pushing still needs your OK each time.
- `DEPLOY-REGISTRY` currently maps this repo to "local :3000 + Supabase partajat", so any public deploy must be re-mapped first.

**How the plan is ordered.** Waves 1-3 are local-only and can start today with no owner action: truth and loud failure in courier and dispatch, then checkout and kitchen, then money rails. W4 is the first wave that needs your accounts: staging, EAS, push and maps keys, real-device gates. W5 is production plus a closed cash/POS pilot. W6 is maib card online, gated on the contract. W7 is parity chosen by pilot data.

**Realistic parity target.** "Bolt Food clone 100%" here means: the customer, courier and restaurant flows a Chisinau user sees in Bolt or Glovo, rebuilt clean-room, working end to end on real coordinates, real push, real money. It does NOT mean Bolt's scale machinery, Bolt's code or assets, or the features Bolt runs in other markets.

**Status of the lens plans.** The three lens plans are superseded. The fatal critiques are all addressed: device and push prerequisites, auth SMTP, web hosting, the payout cron auth, real account deletion, the location-consent text, async OSRM/maib through an outbox, and the offer-preview RPC.

Nothing was modified. The two uncommitted user files, `docs/LOOP-NOAPTE.md` and `src/app/(customer)/orders/page.tsx`, were left untouched.

AUTOCORECȚIE: two critique claims were wrong — "no git remote" (there is one) and "sweeper live body is 20261002000200" (it is 20261003001100). DATE-LIPSĂ: hosted Supabase auth/SMTP policy, whether `postgres` may write `auth.users` on hosted, the maib API variant, Apple enrollment for Moldova.

## Tinta de paritate

Realistic target: "Bolt-like" means the flows and UX a Chisinau user experiences in Bolt or Glovo, rebuilt clean-room (no Bolt code, copy or assets), for generalist restaurants only, 100% operational for three roles.

**Customer (Expo client)**
- Pin-accurate address with entrance and floor details.
- Only venues that deliver to the chosen address.
- Menu with sold-out states and per-item notes.
- Cash/POS checkout; card online once maib is live.
- Live tracking, help/support, account deletion, RO + RU.

**Courier (Expo driver)**
- Real offers ranked on real distance.
- Navigation and call buttons, entrance and floor details, proof of delivery.
- Earnings and a weekly IBAN payout.

**Restaurant (web PWA on a tablet)**
- Queue that rings and stays awake.
- Accept or reject with a reason, busy mode, quick sold-out.
- Order history, print ticket, courier card, weekly CSV.

**Ops**
- Errors are loud, stuck-order alerts reach a person, manual dispatch fallback.

**What it can NOT mean (explicitly out, or only after pilot data)**
- Not in scope: Bolt Market/grocery, Bolt Plus subscription, wallet top-ups, group orders, DineOut/table booking, Sunmi/POS API integrations, native merchant app.
- Gated on pilot data: batching/stacked orders, surge/dynamic pricing, global matching, ML ETA, Redis geo/event bus.
- Not achievable here: Bolt-scale algorithms (they serve millions of decisions a month; this pilot is roughly 5k), and Bolt's brand.

**How completion is measured**
- Parity is measured against `replica/features.csv`: 157 rows, of which 41 yes, 51 partial, 54 no and 11 skip.
- Target for "ready to use": every "must" row in the customer, courier, restaurant and ops slice is yes or consciously cut, with the cut ratified by you.
- The pilot exit gate: at least 50 real delivered orders across at least 3 restaurants in 7 days, zero orders stuck more than 15 min without a human, and the first weekly payout paid.
- "100%" is a statement about working operations, not about every Bolt feature row.

## W1 — Courier and dispatch tell the truth; failures are loud (local only, startable today)

Efort: ~1.5-2 weeks (1 backend + 1 mobile agent stream; Expo upgrade in its own commit first)

Scop: The driver app shows only real data, can navigate and call, and dispatch ranks real couriers fairly. Every swallowed error becomes a visible row. All of this is proven by SQL sims and vitest on the local stack, with no owner action.

- **mobile/driver/package.json, mobile/driver/app.config.ts** — Upgrade mobile/driver from Expo ~54.0.8 / RN 0.81.5 to the client's line (~57.0.27 / RN 0.86.3) with the expo:expo-upgrade skill, as its own commit before any other driver change. Port the client's app.config.js handling of GOOGLE_MAPS_ANDROID_API_KEY into driver app.config.ts (no key value; env only).
  - Acceptanta: `grep '"expo": "~57' mobile/driver/package.json` hits; `cd mobile/driver && npx tsc --noEmit && npm test` green; `npx expo-doctor` shows no SDK mismatch. Device re-test of background GPS is deferred to W4 and recorded there.
- **mobile/driver/src/lib/api.ts, mobile/driver/src/screens/ActiveDeliveryScreen.tsx** — Remove synthetic data. mapOrders selects restaurants.lat/lng and addresses.lat/lng (readable from courier_assigned onward under addresses_courier_assigned_read) plus notes, building, entrance, floor, apartment, intercom_code and contact_phone. Pickup and drop-off become separate nullable points. Delete the +0.008/+0.005 drop-off, the '4.9' rating, the badge '3' and the 'Client' name. A null point renders 'fără pin' plus the text address.
  - Acceptanta: `grep -nE 'Math\.(sin|cos)|0\.008|0\.005|4\.9' mobile/driver/src/lib/api.ts mobile/driver/src/screens/ActiveDeliveryScreen.tsx` returns nothing. A new vitest in mobile/driver/tests on mapOrders: a seeded row maps to exact restaurant and address coords, and a null address lat gives dropoff=null. Control: the test fails on the old mapOrders.
- **ActiveDeliveryScreen.tsx + a small pure helper buildNavUrl()** — Wire Linking by porting the web courier page logic (src/app/(courier)/deliveries/[deliveryId]/page.tsx:60-62, 88, 115). 'Navighează' to the restaurant and to the customer uses a Google/Apple Maps deep link from coords, with the text-address fallback the web already uses. Add tel: buttons for the restaurant and the customer. No policy is widened.
  - Acceptanta: `grep -c 'Linking.openURL' ActiveDeliveryScreen.tsx` is at least 3. A vitest on buildNavUrl covers both the coord case and the text fallback.
- **mobile/driver/src/screens/MapScreen.tsx (or a useOnlineHeartbeat hook)** — Foreground online heartbeat (no new background permission). While the courier is online and MapScreen's useDevicePosition has a fix, upsert courier_locations every 45-60 s or on a ~50 m move, through the same direct upsert. The is_plausible trigger applies. Writing stops on offline. Background idle tracking is NOT added (see dissent), so the LOCATION_ALWAYS text stays true.
  - Acceptanta: A vitest with a mocked supabase client: online plus position gives an upsert; offline gives no upsert; a 30 m move inside 45 s gives no upsert.
- **new supabase/migrations/2026101xxxxx_dispatch_fresh_rank.sql, mobile/driver OfferCard.tsx** — dispatch_order delta (hard rule 9: start from pg_get_functiondef of the live body, 20260813000400). Freshness window goes from 10 to 2 min, matching nearby_available_couriers. A courier with no or a stale fix ranks after every fresh courier, and the 6.0 km insert is removed. dispatch_offers.distance_km is NULL for no-fix couriers, and OfferCard shows 'distanță necunoscută'. Deterministic tie-break on oldest last offer/assignment, with no acceptance term (EU 2024/2831 rule). Plus a docs/migrations.md entry.
  - Acceptanta: New sim tests/rpc/88_dispatch_fresh_rank.sql: (a) fresh fixes at 1/3/8 km plus a no-fix courier, and the offer goes to the 1 km courier; (b) two no-fix couriers of the same vehicle, and the oldest last_offer wins and the other wins the next order; (c) a no-fix courier never beats a fresh one. Control: the sim FAILS against the pre-delta body. `bash scripts/concurrency/run.sh` PASS.
- **new migration + docs/migrations.md** — Sweeper delta from the live body (20261003001100). Both `exception when others then null` (:85, :98) become an insert into a new append-only dispatch_errors(order_id, step, sqlstate, sqlerrm, created_at) plus raise warning. Admin read only (RLS).
  - Acceptanta: New sim tests/rpc/89_sweeper_error_logged.sql forces the error with a temporary raising trigger on dispatch_offers (not REVOKE, because the sims run as superuser). Assert one dispatch_errors row and that the loop continues to the next order. Control: 0 rows on the old body.
- **migration delta + src/app/(admin)/platform existing ops page** — Extend the existing nets instead of building new ones. admin_stuck_orders gets a 3-min 'ready_for_pickup with no live offer' bucket. It also gets a count of dispatch_errors in the last 15 min and of notification_outbox rows unsent for more than 30 s, rendered on the existing platform ops strip. admin_dispatch_metrics gets p50/p90 for ready to first offer and ready to assign, starting from the live view in 20260816000100.
  - Acceptanta: New sim tests/rpc/90_stuck_and_p90.sql: a 4-min ready order with no offer appears in the 3-min bucket; 20 seeded orders give the expected p90, not the average.
- **scripts/check-push-wiring.sql** — Push wiring check script that reads current_setting('app.push_drain_url') and fails on null or host.docker.internal. Run it against a target DB (not wired into `verify`).
  - Acceptanta: `psql -h 127.0.0.1 -p 54422 ... -f scripts/check-push-wiring.sql` prints FAIL on local (default GUC). Proven to bite before W5 uses it on prod.
- **.github/workflows/verify.yml** — Add the CI workflow file, which is not pushed without your OK. It runs verify, test, build, then `bash scripts/supabase-up.sh` with test:rpc and the concurrency run, plus typecheck and tests for mobile/client and mobile/driver.
  - Acceptanta: `npx --yes @action-validator/cli .github/workflows/verify.yml` or an actionlint pass locally. A real green run happens after the push is approved (W4).

Verificare:
- `cd /Users/user/code/chisinau-delivery && npm run verify && npm test && npm run build && npm run test:rpc`
- `bash scripts/concurrency/run.sh`
- `cd mobile/driver && npx tsc --noEmit && npm test`
- `npm run test:e2e (E1,E2 on :3007)`
- `Control runs: sims 88-90 executed against the pre-delta bodies must FAIL`

## W2 — Checkout produces a deliverable order; kitchen tablet does not miss orders (local only)

Efort: ~2 weeks (client + backend + web streams in parallel)

Scop: Every new order carries a real pin inside the venue's radius, plus entrance/floor and per-item notes. The restaurant PWA rings, stays awake and handles rejects and sold-outs. The client meets the store baseline in code: deletion, support contact, safe area, manual-address fallback. RU strings are extracted.

- **mobile/client CartScreen.tsx, AddressesScreen.tsx, lib/checkout.ts** — Make the pin mandatory. A draggable-pin MapView sheet (react-native-maps is already in the client) goes in CartScreen and AddressesScreen, seeded from GPS or the Chisinau center. AddressesScreen stops forcing pin:null, and checkout.ts keeps lat/lng on a label edit. Existing pinless addresses are prompted to set a pin. No geocoding API: the typed street stays the label (autocomplete is deferred, see user_actions).
  - Acceptanta: `grep -n 'pin: null' mobile/client/src/screens/AddressesScreen.tsx` returns nothing. A vitest on addressRow keeps lat/lng after a street edit. CartScreen copy no longer says '(opțional)'.
- **mobile/client AddressesScreen/CartScreen** — Entrance, floor and intercom fields use the EXISTING columns (no migration), required when apartment is set, and are shown to the courier through the W1 block.
  - Acceptanta: A vitest on the validation: apartment without floor fails, a house with no apartment passes.
- **migration + docs/migrations.md, packages/shared-api placeOrder, mobile/client Home** — Service radius plus pin enforcement in a place_order delta from the live body (20261008000200). Add restaurants.delivery_radius_km (default from a versioned config row). Reject when the address lat/lng is null or outside the radius, with a coded RO error, and log the rejection with its distance. Write order_items.notes from p_items. Move the 1400 MDL cash cap into the versioned cash policy (no constants). nearby_restaurants / Home greys out venues that cannot deliver to the selected address. Restaurant onboarding exposes the radius.
  - Acceptanta: New sim tests/rpc/91_place_order_zone_notes.sql: inside the radius OK; 9 km away raises the code; null lat raises; an item note lands in order_items.notes, the owning restaurant can read it and another restaurant gets 0 rows; the cash cap is read from config (changing the row changes the outcome). Control: fails on the old body. Existing money sims stay green.
- **migration delta on the courier tariff functions** — Close the courier pay hole. Courier tariff and payout code that falls back to 6.0 km for pinless legacy addresses (20260731000200:81, :148) flags such deliveries for admin review instead of paying silently.
  - Acceptanta: Sim tests/rpc/92_tariff_no_pin_flag.sql: a pinless delivery produces a flagged row and no silent 6 km payment line.
- **migration + mobile/driver OfferCard.tsx** — Offer-preview RPC: offer_preview(p_offer_id), security definer, returns the drop-off sector, total km and pickup km ONLY to the courier holding that live, unexpired offer. OfferCard renders it.
  - Acceptanta: Sim tests/rpc/93_offer_preview_scope.sql: the holder gets 1 row; another courier, the customer and an expired offer get 0 rows / raise.
- **mobile/client/src/lib/api.ts:113 + menu UI** — Sold-out state: fetchMenu returns unavailable items, rendered greyed out with 'Epuizat' and not addable.
  - Acceptanta: A vitest: an unavailable item is present with available=false and the add action is disabled.
- **migration, mobile/client ProfileScreen, src/app/(customer)** — Account deletion. A delete_my_account RPC (security definer, self only) runs erase_customer_pii, also nulls addresses.contact_phone, deletes device_push_tokens and sets auth.users.banned_until far in the future. Orders and money rows are kept. ProfileScreen has a confirm, then the RPC, then sign-out. The web (customer) area gets a deletion page for the Play Data safety URL. If hosted grants block writes to auth.users, fall back to a service-role Next route (W4).
  - Acceptanta: Sim tests/rpc/94_delete_account.sql: after the RPC, profile, addresses and contact_phone are erased, push tokens are gone, banned_until is in the future, and orders are still present. A local GoTrue login for that user then fails (scripted curl against 127.0.0.1). Another user cannot call it for someone else.
- **mobile/client, src/app/(customer)/layout.tsx** — Support contact from config. Replace '+373 60 000 000' in LegalScreen.tsx:10, tracking.ts:102 and src/app/(customer)/layout.tsx:99 with values from env/config (owner supplies the real values; the build fails closed to hidden if they are unset). 'Problemă cu comanda' on OrderTracking opens tel/mail with the order number prefilled.
  - Acceptanta: `grep -rn '60 000 000' mobile/client/src src` returns nothing.
- **mobile/client screens** — Safe area and targets: one ScreenHeader using safe-area insets replaces the 7 paddingTop:56 headers; steppers get 44pt targets. Manual-address fallback when location is denied.
  - Acceptanta: `grep -rn 'paddingTop: 56' mobile/client/src` returns nothing. tsc and vitest are green.
- **mobile/client src/i18n, notification templates** — RU readiness: extract client UI and push copy into ro/ru string tables with a language switch, and add the RU copy. A native-speaker review is a user action before the pilot.
  - Acceptanta: A vitest asserts the ro and ru key sets are identical. A grep script finds no hardcoded Romanian string literals in mobile/client/src/screens, with an allowlist file.
- **src/app/(admin)/restaurant/orders (+ /history), orders/[id]** — Kitchen tablet. Screen Wake Lock on /restaurant/orders while visible, re-acquired on visibilitychange (pattern from useBroadcastCourierLocation). A one-time 'Activează sunetul' AudioContext unlock plus a warning pill while sound is locked. Reject with preset reasons through the existing rejectOrder. 30-day history page. @media print ticket plus window.print. Quick 'Stoc epuizat' list via toggleItemAvailability.
  - Acceptanta: Playwright (plugin MCP or tests/e2e) on :3007: wakeLock.request is spied as called; a placed order shows in the queue within 10 s; reject with 'Produs epuizat' shows that reason on the customer order. Sim tests/rpc/95_restaurant_history_rls.sql: a second restaurant user sees 0 foreign rows.
- **migration + orders/[id]** — Restaurant courier card once a courier is assigned: first name plus live map (RestaurantPickupMap). The phone comes through a NEW restaurant_courier_contact RPC gated on has_restaurant_access and the order status, only if you decide restaurants may see it.
  - Acceptanta: Sim tests/rpc/96_restaurant_courier_contact.sql: the owning restaurant gets the name and phone only between assigned and delivered; other restaurants and customers get 0 rows.

Verificare:
- `npm run verify && npm test && npm run build && npm run test:rpc`
- `cd mobile/client && npx tsc --noEmit && npx vitest run`
- `npm run test:e2e (E1-E5, :3007)`
- `Playwright run with screenshots read via the see skill for the tablet queue (1024x768)`
- `Control runs for sims 91-96 against the pre-delta bodies`

## W3 — Money rails couriers and restaurants actually get paid by (local only; tax logic excluded)

Efort: ~1-1.5 weeks

Scop: The weekly settlement runs from cron without a JWT, is idempotent, and produces a bank-ready CSV to IBANs. Restaurants and couriers can export earnings. Payment and HTTP side effects get an outbox design, so later card and OSRM work is not done synchronously inside RPCs.

- **migration + docs/migrations.md** — Cron-safe payouts: an internal generate_payouts_internal(week) function, revoked from authenticated/anon, holds the logic. admin_generate_payouts becomes a thin admin-checked wrapper. A pg_cron weekly job (Monday 06:00, previous Mon-Sun) calls the internal function. It is idempotent per payee per week, and paid payouts stay frozen.
  - Acceptanta: Sim tests/rpc/97_payout_cron_idempotent.sql runs the internal function with no JWT (request.jwt.claims unset) twice for the same week: exactly one payout per payee, and paid rows are untouched. The authenticated role calling the internal function raises.
- **migration, mobile/driver ProfileScreen, src/app/(admin)/restaurant settings** — IBAN fields. Courier IBAN in the driver Profile (replaces the dead 'Cont bancar' row) and restaurant IBAN in partner settings. Format plus MD checksum validation in a CHECK or function. Owner-only read/write, admin read.
  - Acceptanta: Sim tests/rpc/98_iban_rls.sql: owner read/write OK, another courier or restaurant and a customer get 0 rows, admin can read, an invalid checksum is rejected.
- **src/app/(admin)/platform payouts, restaurant earnings, mobile/driver earnings** — Admin payout batch CSV export (IBAN, name, amount, reference). No bank API. Restaurant weekly orders/commission CSV. Courier history shows tips; web and mobile earnings totals are reconciled.
  - Acceptanta: A vitest on the export function: the CSV total equals sum(payouts.net) for a seeded batch. A vitest asserts the mobile earnings total equals the shared-api total for the same fixture.
- **migration + src/app/api/outbox/drain/route.ts** — http_outbox design. A Postgres table enqueues outbound calls (maib capture/refund, OSRM refresh), drained by a Next route like /api/push/drain. Build only the table, the drain skeleton and one sim now; providers plug in at W6/W7.
  - Acceptanta: Sim tests/rpc/99_http_outbox_enqueue.sql: one enqueue gives one row; a replayed enqueue with the same idempotency key gives no duplicate. A vitest on the drain with a mocked fetch: success marks the row sent, failure increments attempts.

Verificare:
- `npm run verify && npm test && npm run build && npm run test:rpc`
- `Control: sim 97 fails if the internal function keeps the has_role check`
- `cd mobile/driver && npm test`

## W4 — Staging and real devices: push, maps and builds work outside localhost

Efort: ~1-1.5 weeks of code/config, after the owner accounts exist

Scop: A staging Supabase project is reachable from phones. Both apps are on dev-client/internal builds with real push tokens (FCM/APNs). The web app runs on a mapped staging host. Every 'works on mobile' claim from W1-W2 is re-proven on a physical device.

- **supabase CLI against staging (explicit OK per push)** — Push all migrations to the NEW staging project (never rdowjxnuyawhrjppxzuu), with load/demo seeds only. Set app.push_drain_url and app.push_drain_secret to the staging HTTPS drain.
  - Acceptanta: `scripts/check-push-wiring.sql` on staging prints PASS. get_advisors (Supabase MCP, read-only) has no ERROR-level security findings.
- **Vercel or the chosen host; .github/workflows/verify.yml** — Deploy web partner/admin plus /api/push/drain to the staging host mapped in DEPLOY-REGISTRY, with SUPABASE_SERVICE_ROLE_KEY and PUSH_DRAIN_SECRET only in the host secret store. Push the CI workflow and get a green run.
  - Acceptanta: The CI run is green on a branch, and a deliberately broken sim turns it red (control). `curl -s -o /dev/null -w '%{http_code}' <staging>/api/push/drain` returns 401/405 without the secret (not 5xx).
- **mobile/*/eas.json, app.config.*** — Run `eas init` for both apps (EAS_PROJECT_ID), add a preview/internal profile and channels, wire googleServicesFile through an EAS file secret, upload the FCM v1 key and the APNs key, and pass GOOGLE_MAPS_ANDROID_API_KEY as an EAS secret for both apps.
  - Acceptanta: `eas build --profile preview --platform android` succeeds for both apps. On the device, getExpoPushTokenAsync returns a token and a device_push_tokens row exists on staging.
- **physical devices + see skill on screenshots** — Device gate for W1-W2 on one physical Android (Android first) and one iPhone if enrolled: a backgrounded driver receives an offer push; pins match the seeded coords; 'Navighează' opens Maps at the right point; the foreground heartbeat writes every 45-60 s; background delivery GPS still works after the SDK 57 upgrade; the client drops a pin, places a cash order and deletes the account.
  - Acceptanta: A screenshot set reviewed with the see skill and saved under docs/evidence/W4/. A SQL check on staging shows courier_locations refresh intervals of 60 s or less and the delivered order with the pinned drop-off.
- **Supabase dashboard config, src/app/login set-password page, restaurants/actions.ts** — Prod-grade auth on staging: custom SMTP (provider chosen by you) with a sender domain and SPF/DKIM; recovery/invite templates uploaded; site URL and redirect URLs including the app schemes; the email-confirmation setting matched to how the client's signUp behaves. invitePartner gets a redirectTo pointing at a new set-password page.
  - Acceptanta: E2E against staging: signup confirm, password reset by OTP and a partner invite each reach a real inbox, and the invited partner sets a password and logs in.

Verificare:
- `npm run verify && npm test && npm run build && npm run test:rpc (CI green)`
- `psql <staging> -f scripts/check-push-wiring.sql`
- `eas build --profile preview (both apps)`
- `Device evidence reviewed with the see skill, stored in docs/evidence/W4`

## W5 — Production plus a closed pilot on cash/POS

Efort: ~1.5-2 weeks of code, plus your calendar time

Scop: A dedicated production stack with alerts that reach a person, a load test passed on staging, real venues and couriers, and the pilot exit gate met.

- **infra + src/lib/routing/route.ts + src/proxy.ts** — Set up the NEW prod Supabase Pro project: migrations without seeds, push GUCs, pg_stat_statements, PITR as you decide. Prod web on the mapped host. Self-hosted OSRM (Moldova extract) on a VPS, with the router.project-osrm.org default removed from src/lib/routing/route.ts (fail closed to haversine with a warning). Turn off the dev doorways in prod (/enter/[role], password-less /master, dev autologin in src/proxy.ts) and clean the junk dirs in the repo root.
  - Acceptanta: `check-push-wiring.sql` on prod prints PASS. `grep -n 'router.project-osrm.org' src/lib/routing/route.ts` returns nothing. A prod curl to /master without a password returns no session. `ls '-i' 'HOME=' 'PATH=' 'http:'` fails (dirs gone).
- **migration + http_outbox from W3, Sentry SDKs** — Alerting with a mechanism: a pg_cron check every minute posts to a webhook (Telegram/SMS/email, chosen by you) on any of: a dispatch_errors row, an outbox row unsent for more than 30 s, a failed cron.job_run_details entry, a ready_for_pickup order with no offer for more than 3 min. Sentry in web plus both apps (after install approval). An uptime check on web and the drain. On-call and pilot steps added to the EXISTING docs/GHID-OPERATIONAL.md.
  - Acceptanta: On staging, inserting a synthetic dispatch_errors row delivers an alert to the chosen channel within 2 min. A forced error in each app appears in Sentry within 5 min.
- **scripts/load/** — k6 load test on STAGING only: 300 orders/h for 30 min, then a 3x spike, with Realtime listeners and the admin ops page open, and seeds spread over the real Chisinau area. Test users are created with token columns set to ''.
  - Acceptanta: The report is saved: place_order p95 under 500 ms, ready to first offer p95 under 20 s, zero double assignments, zero stuck orders. A control run with a 50 ms threshold fails.
- **scripts/check-coords.sql** — Real data gate: a check against the target DB (deploy/runtime gate, NOT in npm run verify) that fails if an active restaurant has null, seed or out-of-Chisinau-bbox coordinates. Real menus and photos. Couriers enter through the existing /devino-partener plus admin KYC flow.
  - Acceptanta: It fails on local seeds (proves it bites) and passes on prod before go-live.
- **EAS submit config** — Pilot distribution: the courier app goes out as an EAS internal APK (Android first; TestFlight if Apple is ready). The client goes to Play internal/closed testing and TestFlight. Store listings include a demo account and the deletion URL.
  - Acceptanta: Pilot exit gate: at least 50 real delivered orders across at least 3 restaurants in 7 days; zero orders stuck more than 15 min without a human action; the first weekly payout CSV generated and paid.

Verificare:
- `npm run verify && npm test && npm run build && npm run test:rpc (CI)`
- `psql <prod, read-only> -f scripts/check-push-wiring.sql && psql <prod> -f scripts/check-coords.sql`
- `k6 run scripts/load/peak.js against staging`
- `A synthetic alert fired and received`

## W6 — Card online via maib (contract-gated); cash/POS stays first-class

Efort: ~2 weeks, starting only when sandbox credentials exist

Scop: Card payment, refund and reconciliation work against the maib sandbox, then live after a 10 MDL test. No HTTP is called inside RPCs.

- **src/lib/payments/maib.ts, src/app/api/payments/maib/callback/route.ts, migration** — maib adapter. First confirm the API variant (e-commerce v1 vs maib Checkout) and the signature scheme from the official docs. Token and create-payment calls, a hosted checkout in an in-app browser, a callback route that verifies the signature and calls confirm_online_payment as service_role. A payment_events table (unique on provider+event_id). Capture and refund go through the W3 http_outbox. A daily reconciliation job.
  - Acceptanta: A vitest with a known-good and a known-bad signature vector: the bad one gives 4xx and no state change. Sim tests/rpc/1xx_payment_replay.sql: a callback replayed 3 times gives one capture and one event row. A sandbox E2E with the test card gives captured, then refunded. `grep -rn` for the secret env names finds hits only in .env.example.
- **migrations + both apps' status mapping** — Model the payment state honestly: decide either pending_payment as an order status (touches the transition RPCs, expire_stale_orders, stuck views and both apps' mappings) OR keep the order out of the restaurant queue until the intent succeeds. Pick one in a design note before coding.
  - Acceptanta: A sim: an unpaid card order never appears in the restaurant queue or in dispatch; a timeout releases it.
- **env** — Flip NEXT_PUBLIC_ENABLE_ONLINE_PAYMENT only after the 10 MDL live test and one clean reconciliation day.
  - Acceptanta: The reconciliation report shows 0 differences for that day.

Verificare:
- `npm run verify && npm test && npm run build && npm run test:rpc`
- `maib sandbox E2E script`
- `Reconciliation job output = 0 mismatches`

## W7 — Parity picked by pilot data

Efort: Open-ended; each item S-M

Scop: Add the Bolt-visible features the pilot shows are blocking, one at a time, each with its own sim and a before/after metric.

- **migration + restaurant orders page + client tracking** — Restaurant busy mode (+15/30/45 min) feeding estimated_ready_at and the customer ETA.
  - Acceptanta: A sim: busy_until moves the estimate and the customer ETA. A Playwright check that busy +15 shifts the SLA chip.
- **migration + driver UI** — Courier issue reports (running late, cannot find venue, customer unreachable) as an RPC writing to delivery_status_events, shown in admin_stuck_orders. The unreachable outcome follows the policy you ratify.
  - Acceptanta: A sim: only the assigned courier in a valid status can report; admin sees the row.
- **migrations + client/admin UI** — Support cases (one open case per order, admin queue, refund bridge). Delivery PIN for card-online orders. Pickup order type, built together with the dispatch_order, sweeper and stuck-view exclusions and a complete_pickup_order RPC.
  - Acceptanta: Sims: a second open case raises; a wrong PIN rejects; a pickup order never gets a dispatch_offers row and is never flagged as stuck.
- **migrations + quote_checkout RPC + client basket** — Fee engine (small-order and service fees as versioned rows, delivery fee priced against the courier tariff), then promo codes (server-applied in place_order only). Fees are computed asynchronously through OSRM via the outbox; quote equals charge.
  - Acceptanta: Sims: fee tiers, small-order fee, quote_checkout equals place_order on the same fixture, the write-once trigger still bites. vitest fixtures agree with SQL to the bani.
- **various** — Address autocomplete with a production-licensed provider; JIT dispatch per restaurant gated on prep_accuracy_truth; batching and surge only when the W5 dashboard shows the trigger.
  - Acceptanta: Each item is gated on a recorded pilot metric before and after.

Verificare:
- `npm run verify && npm test && npm run build && npm run test:rpc per item`
- `Control run that fails on the old behaviour, per item`

## Actiuni care tin doar de owner

- [W7 (and the definition of done for W5)] Ratify the scope and parity target: generalist restaurants; promos, wallet, Plus, group orders, batching, surge and the native merchant app deferred to pilot data. 'Ready to use' means the pilot exit gate, not every row of features.csv. — Your request said '100% Bolt clone'. Deferring most parity rows is a decision you must make, not the plan.
- [W4] Approve the commits in W1-W3 (pre-authorized by the repo's CLAUDE.md) and approve each push to github.com/legie123/chisinau-delivery. — The CI workflow only runs once pushed. Pushes need your OK each time.
- [W2 (values can land later; the code reads config)] Supply the real support phone, email and staffed hours. Decide whether restaurants may see the courier's phone. — They replace the placeholder support number and gate the restaurant_courier_contact RPC.
- [W5] Arrange a native Russian-speaker review of the RU strings. — Machine-made RU copy should not ship to customers unreviewed.
- [W4 (staging), W5 (prod)] Approve and pay for NEW Supabase projects (staging, and prod on Pro), never rdowjxnuyawhrjppxzuu. Decide PITR. Approve every remote migration push. — Phones cannot reach the 127.0.0.1-only local stack (the tunnel has a 90-min TTL). Production needs its own project.
- [W4] Pick the web host and domain. Re-map ~/code/chisinau-delivery in DEPLOY-REGISTRY.json (currently 'local :3000 + Supabase partajat'). Approve each deploy. — The push drain, partner portal, admin and maib callback need a public HTTPS server. An unmapped deploy is denied by arbitrate.mjs.
- [W4] Create an Expo/EAS account and approve eas-cli via npx. Create a Firebase project (FCM v1 key), an Apple Developer org account with an APNs key (D-U-N-S; check Moldova eligibility), and a Google Play org account (or plan the 12-tester / 14-day closed test). Create a Google Cloud Maps Android key with billing, restricted to the package and SHA. — Without EAS projectId plus FCM/APNs there are zero push tokens, so backgrounded couriers never get offers. Without the Maps key the Android map is blank.
- [W4] Provide test hardware: at least one Android phone (plus an iPhone if Apple enrolls) and one Android tablet for the kitchen PWA. — There is no simulator or Android SDK on this Mac. Device evidence is mandatory.
- [W4] Choose an SMTP provider and sender domain (Resend/Postmark/SES), with DNS for SPF/DKIM. Decide whether phone OTP via SMS is wanted (needs an SMS provider). — Hosted Supabase's default mailer is unlikely to deliver signup, reset and invite emails to real users.
- [W5] Approve installing the new capabilities: Sentry SDKs plus an org and DSNs, k6, supabase/agent-skills, Maestro (optional), and the alert channel (Telegram bot/SMS/email) plus who is on call during pilot hours. — Third-party code needs promotion from quarantine. An alert needs a person who receives it.
- [W5] Provide a small VPS for self-hosted OSRM (Moldova extract) and own its uptime. — The public router.project-osrm.org is not for production use.
- [W5 (stores) / W6 (card)] Register or confirm the legal entity (SRL/ÎI with IDNO) and open a maib business account. — The root dependency for the store org accounts, the acquiring contract and the partner contracts.
- [W5 (first real payout)] Decide the courier engagement model (employee / ÎI-SRL invoicing / fleet partner) in writing with an accountant or SFS. Treat the old '1 July 2026 / 15% regime' item as an open question, not a fact. — The payout format and any tax logic depend on it. The plan builds no tax logic until the answer exists.
- [W5] Decide fiscal duties and merchant of record: who issues the fiscal receipt for courier-collected cash and card, e-Factura/VAT invoicing, whether collecting restaurant money needs payment-agent status, and the Chisinau local tax on online shops. — These can block launch even with green code. The vault MASTER-AUDIT flags receipts and the local tax.
- [W5] Card-on-delivery: get POS/SoftPOS terminals per courier and an acquiring contract, OR remove the POS option and rethink the 1400 MDL cash cap (which moves to config in W2). — Orders above the cash cap depend on POS hardware nobody has listed yet.
- [W6] Email ecom@maib.md for sandbox credentials and the questionnaire. Ask in writing for MDR, settlement time and refund terms. In parallel, ask Paynet for its API docs and decide primary vs fallback (the vault audit recommends Paynet + MIA, with maib second). — W6 cannot start without test credentials and a provider decision.
- [W2 (radius, cash cap), W5 (the rest)] Ratify the business numbers: courier tariff, cash caps, default delivery radius, offer window (30 s vs 45-60 s), commission, and the customer-unreachable outcome. — The code encodes them as versioned config rows; placeholders are not facts.
- [W5] Sign 3-5 pilot restaurants (ANSA/HoReCa document, IDNO, IBAN, menu with photos, exact coordinates, tablet). Recruit 5-10 couriers and run KYC in admin onboarding. — The pilot exit gate needs real venues, couriers and orders.
- [W5] Get a lawyer's review of the platform terms, the privacy notice under Law 195/2024 (processor list: Supabase, Expo, maib, Sentry, the OSRM host), and the restaurant and courier contracts. No age-restricted items until signed off. — Store review and legal exposure.
- [W7] Decide the brand direction (dark luxury vs neutral, image-led) before any visual rework beyond the W2 safe-area and target fixes. — Avoids redoing the UI work twice.

## Riscuri

- Hard rule 9: dispatch_order, the sweeper, place_order and the payout functions are each recreated. Every delta must start from pg_get_functiondef of the LIVE body. Verified example: the live sweeper is 20261003001100, not the 20261002000200 two lenses cited.
- There is no simulator, adb or eas on this Mac. W1-W2 mobile changes are proven only by tsc and vitest until W4's device gate, so 'works on mobile' cannot be claimed before then.
- The Expo 54 to 57 driver upgrade can break background delivery GPS (expo-task-manager) or maps. It is isolated in its own commit, but it can only be re-tested on a device in W4.
- A foreground-only heartbeat means a courier whose app is backgrounded while idle goes stale and ranks last. That is acceptable for a 5-10 courier pilot with admin_assign_courier as the manual fallback, but ranking quality depends on couriers keeping the app open.
- A mandatory pin plus a radius can reject legitimate addresses at sector edges. The radius is per-restaurant config, every rejection is logged with its distance, and the pin is draggable.
- Whether a security definer function owned by postgres may set auth.users.banned_until on HOSTED Supabase is NEVERIFICAT. The service-role route fallback is planned for W4.
- Push is best-effort end to end (outbox, pg_net, Next, Expo, FCM/APNs). Aggressive Android battery managers can still drop offers. The receipts check and the stuck-order alert are the mitigation, not a guarantee.
- Owner lead times (legal entity, D-U-N-S, Play closed test, maib onboarding) are the real critical path. If they slip, the pilot runs cash/POS with the courier app as an internal APK.
- Courier legal status and fiscal-receipt duties are unresolved. A wrong model creates back-tax or reclassification exposure, and no tax logic is coded until there is a written answer.
- The tablet PWA can still be killed by the browser or lose Wi-Fi. The existing restaurant push ('Comandă nouă') and the 3-min no-offer alert are the second channel.
- Two uncommitted user files (docs/LOOP-NOAPTE.md, src/app/(customer)/orders/page.tsx) are in the tree. Waves touching the customer orders page must check git status first and never stage them.

## Dezacorduri nerezolvate

- Russian timing. The parity and operational critiques say RU must ship before the pilot or the pilot data is biased; the operational lens deferred it. I put string extraction plus RU copy in W2 with a native review before W5. A Romanian-only pilot cohort is a cheaper alternative you could choose instead.
- Idle background tracking vs foreground heartbeat. The backend and parity lenses wanted 'Always' background idle GPS; the critiques showed it breaks the declared purpose string and needs a Play re-declaration. I chose foreground-only for the pilot. Revisit if stale-courier share is high in W5 data.
- Payment provider. The lenses chose maib primary; the vault MASTER-AUDIT recommends Paynet for collection plus MIA for disbursement, with maib second. Not resolvable without quotes; left to you.
- Fee engine timing. The backend lens wanted server ETA, fees and service areas in an early wave; the critiques showed pg_net is async and route_cache will miss. I deferred fees to W7 and kept the flat delivery_fee_mdl for the pilot. Risk: long trips lose money under per-km courier pay until then.
- Whether the web courier PWA (/deliveries) can carry the pilot instead of the Expo driver. It already has real navigation and tel links. I kept the Expo driver as the target but did not make it the only path; if W4 slips, a web-PWA courier pilot is a viable fallback the plan does not formally schedule.
- Coordinate check location. The backend lens wanted it in npm run verify; the critique showed that measures local seeds. I made it a target-DB gate, which means a mistake is caught only at deploy time, not on every commit.
- Delivery radius vs PostGIS service-area polygons. I chose a per-restaurant radius as the smaller diff; a polygon (exclusions such as river or industrial zones) may be needed after the pilot.
- Pickup order type, wallet and promo codes before or after the pilot. Two lenses put them earlier; I put them all in W7 behind pilot data.

## Critic de completitudine

**Omissions in the final plan, grouped by area, each tagged with its wave**

Checked read-only on 2026-10-11 against the repo. All 11 requested areas were checked; none came back "none". Items are VERIFICAT unless marked PROBABIL.

**Support and refunds**
1. **W5:** There is no minimum pilot support path before W7's support cases. No complaints log exists and no partial refund or compensation RPC exists (grep for partial/compensat/credit/adjust: 0 hits). For a cash order with a missing item, ops has no tool and no written policy. Add a complaint note on the order, a partial-adjust RPC with a sim, and a written refund/compensation policy.
2. **W1, policy in W5:** Orders with no courier are auto-cancelled only after 6 hours (`expire_stale_orders`, `20260812000000`:52-80). The plan adds a 3-minute alert but no cut-off the customer sees. It also says nothing about who pays the restaurant for food already cooked. Needs a short configurable cut-off, a customer push, and a ratified compensation rule.

**Onboarding**
3. **W2:** `place_order` will start rejecting orders without a pin, but the WEB customer checkout still has an optional, GPS-only pin (`src/components/customer/CheckoutForm.tsx`:114, "Optional GPS pin"). W2 only fixes the mobile client, so web checkout would break. Either give web the draggable pin too, or close web ordering.
4. **W5:** Menus can only be entered by hand; there is no bulk import (no CSV/import in `restaurant/menu`). Loading 3-5 real menus with photos needs an import script or a menu-entry service step, and a photo-rights confirmation from each restaurant.
5. **W5:** `scripts/onboard-real-restaurant.mjs` seeds a real venue ("Vatra Neamului") with a fake phone number and "representative" prices. Add a gate so it can never target staging or prod without a signed partner. Also add a step that purges demo and test accounts.
6. **W5:** There is no setup checklist for the restaurant tablet: install the PWA on the home screen, kiosk/guided mode, charger, Wi-Fi, volume, first-time sound unlock. There is also no courier kit list (thermal bag, power bank, mobile data, cash float).
7. **W4, PROBABIL:** The plan only covers credentials for invited restaurant partners. How an approved courier gets a login for the driver app is not covered (only `invitePartner` gets a set-password page).

**Payouts**
8. **W3:** The weekly pg_cron job runs in UTC ("Monday 06:00, Mon-Sun"). Week boundaries must be computed in Europe/Chisinau, including DST changes, or the edge orders land in the wrong week. Add a sim for an order at 23:30 local on a Sunday.
9. **W3:** The CSV is called "bank-ready", but no bank format is chosen. The batch import format of the receiving bank (maib/other) is unknown. This should be a user action, and the export should be validated against a real bank sample.
10. **W3:** The plan sends no payout statement (remittance per payee per week) to couriers or restaurants. Disputes will come in by phone.

**Notifications**
11. **W4:** The secrets list for W4 names only `SUPABASE_SERVICE_ROLE_KEY` and `PUSH_DRAIN_SECRET`. The code also reads `VAPID_PRIVATE_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_SUBJECT` (restaurant web push), `EXPO_ACCESS_TOKEN`, `NEXT_PUBLIC_SITE_URL` and `OSRM_URL`. Without the VAPID keys the restaurant's second channel ("Comandă nouă") is dead.
12. **W5:** The alert list has no `pending_restaurant` bucket. An order the restaurant has not accepted within N minutes should alert ops to phone the restaurant. Today it is cancelled silently when `accept_sla_minutes` runs out.
13. **W4:** Customers who did not grant push permission (and web customers) get no order confirmation by email or SMS.

**Legal pages**
14. **W2 (code) + W5 (text):** Acceptance of terms and privacy is not recorded: no `terms_accepted`, consent row or version (0 hits). Add a record of the accepted version and timestamp for customers, couriers and restaurants.
15. **W5:** The processor list is incomplete. Missing: Google (Maps SDK), FCM/APNs, the web host, the SMTP provider, Nominatim/OSM (geocoding in `src/lib/geo/geocode.ts`), and Anthropic/Ollama. The admin AI (`src/lib/ai/context.ts`, `ANTHROPIC_API_KEY`) sends order context to it. Either disable admin AI in prod or declare it.
16. **W5:** "Dragons Alliance SRL" is hardcoded in `termeni/page.tsx`:13 and `LegalScreen.tsx`:22. It must match the real entity (IDNO, seat, contact), and the legal pages need RU versions. W2's RU work only covers UI strings.

**Store publishing**
17. **W4:** Mobile updates are not covered. There is no `expo-updates`/`runtimeVersion` and no minimum-version gate (0 hits). After a migration changes an RPC, old installed versions break with no way to force an update.
18. **W5:** Several store items are missing:
    - iOS privacy manifest and App Privacy labels
    - Play Data safety form and content rating
    - RO/RU listings with screenshots
    - final icon and splash
    - final bundle ID and package name before the first upload (cannot be changed later)
    - the Play background-location declaration with video, if the driver app ever moves off the internal APK

**Monitoring and alerts**
19. **W5:** Alerts are missing for:
    - Supabase resource limits (disk, connections, Realtime quota)
    - `pg_net` HTTP failures (`net._http_response`)
    - the OSRM VPS uptime
    - Expo push receipts. The risks section cites a "receipts check", but no item builds it; `src/lib/push/expo.ts` should be checked for whether it handles DeviceNotRegistered.

**Backups**
20. **W5:** The plan only says "PITR as you decide". Missing:
    - a daily off-site `pg_dump`
    - a restore drill into staging, with a measured RTO
    - a backup of the storage buckets (`kyc-documents`, `delivery-proof`, `restaurant-photos`), which PITR does not cover
    - a policy for PII erased by `erase_customer_pii` that still sits in backups

**Security review**
21. **W4/W5:** A full review is needed before prod (security-review/cso skill): the grants on SECURITY DEFINER functions and the RLS across 121 migrations, plus access to the `kyc-documents` bucket. `get_advisors` alone is not enough.
22. **W5:** `platform_admin` can mark payouts paid and refund, but there is no MFA/aal2 (0 hits).
23. **W5:** There is no captcha or rate limit on signup, `place_order` or the `/devino-partener` uploads. Fake cash orders cost restaurants real food.
24. **W5:** Missing: separate secrets per environment, rotating the keys used locally, and `npm audit` in CI.

**Customer fraud**
25. **W5/W7:** Cash ordering has no phone verification and no lower cash limit for new accounts. Fake cash orders cost restaurants real food. "Customer unreachable" in W7 is too late for a cash-first pilot.

**Courier parity**
26. **W2:** The parity target lists proof of delivery for the Expo driver, but no wave item builds it. The web courier has a POD photo (`DeliveryStatusControls.tsx`, bucket `delivery-proof`). The Expo driver has no camera or image picker and no proof-of-delivery upload.

**Launch ops (who answers the phone)**
27. **W5:**
    - No on-call roster or support staffing for pilot hours.
    - No plan to keep couriers online during restaurant hours. Shift booking does not exist, so this has to be an ops roster.
    - No phone tree for when Supabase or push is down (ops phones restaurants and couriers).
    - The 50-order exit gate has no plan for finding pilot customers (a friends-and-family list or similar). This is a user action.

AUTOCORECȚIE: an earlier grep suggested the mobile client has no rating flow. That was wrong: `submit_rating` is in `OrderTrackingScreen.tsx`.

DATE-LIPSĂ:
- Exactly how approved couriers receive credentials.
- Whether `src/lib/push/expo.ts` already polls receipts (it only references DeviceNotRegistered).

I could not read the env files: `.env.local.example` was denied by the guard.
