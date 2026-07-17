Verified against repo: migrations end at `20260708001300_state_machine_hardening.sql` (WS1 shipped), `.bucla/workstreams.md` invariants confirmed (B4 = only migration author, serialized numbering), surfaces split `(customer)/(courier)/(admin)/(marketing)` + `mobile/`.

# ULTRADEEP EXECUTION PLAN — chisinau-delivery

## Serialization spine (why the waves are shaped this way)

Function-body overlap forces a strict DB order — these RPCs are rewritten by multiple designs and each rewrite must diff against the LATEST body, not 001300:

- `assign_courier`: WS1(001300) → **WS3** (adds 15km fail-open guard) → **WS5** (guard→capacity check + route stops) → **WS2** (builds on final body via `accept_dispatch_offer` CAS)
- `cancel_order`: WS1 → **WS5** (skip cancelled stops, fixes admin-cancel-stuck-courier bug) → **WS2** (idempotent no-op superset)
- `advance_delivery_status`: WS1 → **WS5** (route settle)
- `accept_order`: WS1 → **WS4** only (estimated_ready_at stamp) — no overlap with WS3/WS5/WS2
- `courier_locations` triggers: **WS3's** guard trigger delivers ~70% of WS10 AND both designs fix the same `updated_at` bug — **WS10 must be de-duped to shrink to: fraud_flags table + speed check + /platform/fraud** (drop its updated_at fix)
- Migration numbering collision: WS6 and WS10 both claim 001400 — renumbered below.

**Canonical migration sequence (B4 applies local+remote in lockstep):**
001400 WS3-geo → 001500 WS5-routes → 001600 WS2-dispatch → 001700 WS4-eta → 001800 WS6-ratings → 001900 WS10-fraud → 002000 WS7-admin-views → 002100 WS9-push

## WAVE 1 — Geo + batching model + SLA UI (WS3, WS5, WS8)

**Why grouped**: WS3+WS5 are the two remaining `assign_courier` rewrites — landing both closes the serialization bottleneck so WS2 has a stable body to diff against. WS5 at `max_active_deliveries=1` = zero behavior change. WS8 is pure frontend, zero schema, disjoint files from WS3's frontend.

**Agents**:
- **B4 db (serialized)**: 001400 (PostGIS in `extensions` schema, generated geography columns + GiST, courier_location_guard trigger + updated_at fix, `nearby_restaurants`, `nearby_available_couriers`, `courier_dispatch_distance_m`, assign_courier+15km guard) → then 001500 (courier_routes, courier_route_stops, max_active_deliveries default 1, assign/advance/cancel replacements, `reorder_route_stops`, `courier_has_capacity()`). Pre-checks: `select extversion from pg_extension where extname='cron'` (need ≥1.5 for WS2's 15s sweeper — decide TTL now), PG15/PostGIS-3.3 immutability of generated columns. Post: geocode the 2–3 real restaurants by hand, `validate constraint` on addresses bounds.
- **B1 customer + B2 partner (parallel)**: WS8 `SlaCountdown` component → partner OrderQueueRow (update the single call site in restaurant/orders/page.tsx) + customer OrderTracking. Null-until-mounted, never gate Accept on client timer.
- **B3 courier (after 001400)**: staleness-aware last-known position; **B1**: distance-sorted RestaurantBrowser via soft geolocation hook, checkout pin-drop.

**Verify gate**: re-run the ENTIRE WS1 SQL test set (idempotency, split-brain CAS, authz) against the WS5 bodies — the max=1 regression test is the load-bearing one (courier must free on delivered). Customer-JWT check that `nearby_restaurants` respects RLS. `nearby_restaurants` returns distance-ordered rows for a Chișinău point post-geocode. Build+lint+test+smoke on launchd server, one commit per iteration.

**BUCLA end-state**: courier flow byte-identical at max=1; geo RPCs live and indexed; SLA countdown on both surfaces; `.bucla/progress.md` updated; assign_courier body frozen as WS2's diff baseline.

## WAVE 2 — Dispatch engine + dynamic ETA (WS2, WS4)

**Why grouped**: WS2 is the P0 gap (push dispatch) and now has everything it consumes (WS3 distance fns, WS5 capacity helper). WS4 touches only `accept_order` — disjoint from every WS2 function — and its frontend lands on the customer tracking page AFTER WS8 merged (no conflict).

**Agents**:
- **B4 db (serialized)**: 001600 (dispatch_offers + partial unique indexes, `dispatch_order()` scoring engine, accept/decline offer RPCs with CAS claim, cancel_order recreation **diffed against 001500's body**, mark_ready_for_pickup in-line dispatch with exception guard, pg_cron offer sweeper — 15s if cron≥1.5 else per-minute with 60s TTL) → then 001700 (restaurant_prep_stats, `refresh_prep_stats` cron 15min, `get_prep_estimates`, accept_order **diffed against 001300** stamping estimated_ready_at).
- **B3 courier**: realtime OfferCard with countdown; pull feed stays as fallback.
- **B2 partner**: per-order target time in restaurant queue.
- **B1 customer**: live estimated_ready_at countdown via existing useOrderRealtime.

**Verify gate**: adversarial concurrency test — simultaneous `accept_dispatch_offer` + pull `assign_courier` + second dispatch run can never double-assign (CAS `WHERE courier_id IS NULL`). Offer expiry cascades ≤5 waves then falls to pull feed. Re-run WS1 test set again (cancel_order changed). Prep estimate falls back to static below n=5 (expected at current volume).

**BUCLA end-state**: push dispatch live end-to-end with pull fallback; dynamic ETA flowing to customer; scoring degrades gracefully (acceptance-rate-only) for unGeocoded restaurants.

## WAVE 3 — Ratings + Admin ops + Fraud queue (WS6, WS7, WS10)

**Why grouped**: three fully disjoint object sets (ratings tables / security_invoker views+publication / fraud_flags), three disjoint frontend surfaces (customer / admin / admin-subpage). Maximum safe parallelism; only B4's migration application stays serialized.

**Agents**:
- **B4 db (serialized, mechanical)**: 001800 ratings (RPC-only writes, denormalized rating_avg/count, `submit_rating` + `notify pgrst, 'reload schema'`) → 001900 WS10-deduped (fraud_flags, BEFORE UPDATE speed check >150km/h with 0.3km/5s floors + 5-min debounce; NO updated_at trigger — WS3 shipped it; do not rename triggers) → 002000 WS7 (four `with (security_invoker = on)` views, payment-resolution RPC, publication adds wrapped in DO-block catching duplicate_object — check `pg_publication_tables` first on the shared project).
- **B1 customer**: RatingForm on delivered, real `★ 4.7 (12)` in RestaurantBrowser + slug page (columns flow through existing `select *`).
- **B2 admin**: /platform ops center (KPI tiles, kanban board, fleet panel, SVG map) + /platform/queues + /platform/fraud. Render restaurant-KPI view server-side only, no live polling.

**Verify gate**: **security_invoker leak test with a customer JWT is mandatory** (a view without the flag leaks all orders — highest-severity risk in the whole plan). submit_rating: wrong-customer rejected, non-delivered rejected, same-stars retry no-op, re-rating rejected. Fraud trigger flags a synthetic teleport, never blocks the location write. Rebuild + `launchctl kickstart -k gui/501/com.chisinau-delivery.server`.

**BUCLA end-state**: three-sided trust loop closed (ratings), platform_admin has a live ops center + fraud/stuck/refund queues — the launch-operability bar from research §4.6.

## WAVE 4 — Push notifications (WS9) — PARTIALLY USER-BLOCKED

**Why last**: depends on WS2's dispatch_offers table for the latency-critical per-courier offer trigger (otherwise ready_for_pickup broadcasts to all online couriers — noisy); everything else in it is additive and independent.

**Agents**:
- **B4 db**: install pg_net, 002100 (device_tokens self-only RLS, AFTER INSERT trigger on delivery_status_events + second trigger on dispatch_offers, Vault secret read wrapped in exception handler).
- **B4/edge**: deploy `push-fanout` edge function (service role, re-reads event from DB, resolves recipients per status, chunks ≤100, prunes DeviceNotRegistered, skips actor self-notify, Romanian copy).
- **B5/B6 mobile**: expo-notifications token upsert after login in both apps.

**Verify gate**: DB→edge path testable WITHOUT user inputs — assert rows in `net._http_response` + edge logs on each transition; WS1 idempotent retry does NOT double-notify. Device delivery verified only after user unblocks.

**BUCLA end-state**: full pipeline verified to the edge function; device delivery flips on the moment EAS creds land.

## HIGHEST-IMPACT NEXT WAVE: WAVE 1, immediately

It is the critical-path unlock, not just three features: WS3+WS5 are the last two rewrites of the `assign_courier`/`cancel_order`/`advance_delivery_status` bodies, and WS2 — the single biggest product gap (push dispatch, research P0 §2.3) — cannot be written safely until those bodies freeze. It also carries the lowest risk of any wave (WS5 at max=1 is behavior-identical, WS3 keeps numeric lat/lng as the write path so zero client changes, WS8 is schema-free) while delivering visible launch value (distance-sorted browsing, SLA countdown) and fixing two real bugs (courier_locations.updated_at staleness, admin-cancel-stuck-courier).

## USER DECISIONS NEEDED

1. **WS9 credentials (blocks Wave 4 device delivery only)**: (a) `eas init` in both mobile apps, (b) FCM V1 service-account JSON + APNs key uploaded to EAS, (c) EXPO_ACCESS_TOKEN from expo.dev → `supabase secrets set`, (d) Vault secret `push_fanout_secret`, (e) EAS development builds — Expo Go on Android SDK 53+ cannot receive remote push. Cost note: EAS build free tier is limited; may need a paid Expo plan.
2. **Extension installs on the shared LIVE project** (Trade-AI cohabitation): OK to enable PostGIS 3.3 (Wave 1) and pg_net 0.20 (Wave 4)? Both additive, but it's a shared prod instance — explicit go/no-go per invariants.
3. **Restaurant coordinates**: provide addresses/coords for the 2–3 real restaurants so B4 geocodes at Wave 1 apply time; until then dispatch scoring degrades to acceptance-rate-only (correct but less proximity-aware).
4. **Offer TTL policy** if pg_cron < 1.5 on the instance: accept 60s offers (per-minute sweeper) or keep 30s and accept up to 60s cascade latency. B4 checks extversion first; decision only needed if <1.5.
5. **Scope confirmations (deferred by design, need sign-off to STAY deferred)**: customer-facing batch transparency ("stop #2 of 3" — research says hidden batching hurts trust; deferred to post-MVP), rating edits (immutable for MVP), `courier_locations_self_all` policy split (cheap fraud-baseline-reset evasion stays open), route optimization (naive tail-append only). Also: `/enter/[role]` demo doorway removal before public launch — separate small task, when?