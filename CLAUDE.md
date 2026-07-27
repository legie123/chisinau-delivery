# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

Chișinău Delivery — food-delivery platform (sushi/fine-dining + catering) for Chișinău, Moldova. Currency MDL, UI in Romanian. Next.js 16 App Router + Supabase (Postgres/RLS/Realtime/Auth/Storage).

## LOOP RULE (mandatory working mode)

Every non-trivial task in this repo runs as a loop, not a one-shot: define END-STATE (verifiable) + SCOPE + STOP-RULE up front, then iterate Doer → Verifier → Improve.
- **Verifier for this repo** = `npm run build` + `npm run lint` + `npm test` + smoke-test routes over the launchd server (`launchctl kickstart -k gui/501/com.chisinau-delivery.server`, then curl the touched paths) — after EVERY iteration, not at the end. For large changes, add an adversarial review workflow before declaring done.
- **Memory** = one git commit per iteration (atomic, descriptive).
- **Stop** = end-state verified OR 3 iterations OR explicit user stop. Deploys still require explicit user OK.

## Commands

```bash
npm run build        # production build (Turbopack) — must pass before any phase is "done"
npm run lint         # eslint
npm test             # vitest unit suite (tests/unit) — part of the verifier
npm run dev          # dev server
```

- Production server runs as a launchd agent on port 3000 (`com.chisinau-delivery.server`, log `/tmp/chisinau-delivery-server.log`). After a rebuild: `launchctl kickstart -k gui/501/com.chisinau-delivery.server`. Do not kill it ad hoc.
- Verification = build + lint + `npm test` + manual flows in browser per role.
- Shell quirk on this machine: plain commands can fail with `command not found: _lc` — run via `env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" <cmd>`.

## Backend (Supabase)

- Live project: `rdowjxnuyawhrjppxzuu` (shared with dormant Trade-AI tables — do NOT touch `poly_*`, `polymarket_*`, `gladiator*`, `equity_history`, `syndicate_audits`, etc.).
- Schema lives in `supabase/migrations/` (44 numbered files, order matters: couriers before orders). Migrations applied locally via `supabase db reset`; remote sync (via MCP `apply_migration` or CLI) is a deliberate pre-launch step — keep local files authoritative.

### Migrations index (terse — one line each; `scripts/check-doc-drift.sh` verifies every file is listed)
- `20260708000000_roles_and_profiles` — profiles + role check + has_role helpers.
- `20260708000100_couriers` — couriers + courier_locations + self-read RLS.
- `20260708000200_restaurants_and_menu` — restaurants, menu, restaurant_staff, has_restaurant_access.
- `20260708000300_addresses` — customer addresses (street/intercom/notes/geo).
- `20260708000400_orders_and_catering` — orders, order_items, catering_details + scoped RLS.
- `20260708000500_status_events_and_rpcs` — delivery_status_events + the lifecycle RPCs (place_order/accept/reject/ready/assign/advance/cancel/catering).
- `20260708000600_storage_buckets` — restaurant-photos bucket + path-scoped storage RLS.
- `20260708000700_realtime_publication` — adds tables to supabase_realtime publication.
- `20260708000800_function_hardening` — revoke/grant tightening on the RPCs.
- `20260708000900_courier_address_read` — courier reads the delivery address of its order.
- `20260708001000_fix_rls_recursion` — de-recursed scoped-read policies (events/items/couriers).
- `20260708001100_perf_indexes` — hot-path indexes (order_items(order_id), etc.).
- `20260708001200_courier_catering_read` — courier read access for catering orders.
- `20260708001300_state_machine_hardening` — transition guards + expire_stale_orders cron.
- `20260717001400_dynamic_eta` — restaurant_prep_stats + get_prep_estimates + refresh cron.
- `20260717001500_ratings` — ratings table + submit_rating + denormalized averages.
- `20260717001600_dispatch_offers` — WS2 push dispatch: dispatch_offers, dispatch_order, accept/decline, expire cron, courier_has_capacity.
- `20260717001700_ws10_gps_plausibility` — fraud_flags + GPS speed-plausibility trigger.
- `20260717001800_admin_ops_views` — admin ops views + admin_update_payment_status.
- `20260717001900_ws3_postgis_geo` — PostGIS geo columns + nearby_restaurants + location guards.
- `20260717002000_backtest_hardening` — adversarial fixes (catering confirm guard, rating column guard, capacity locks).
- `20260717002100_ws3b_private_location_channel` — private realtime GPS channel RLS.
- `20260717002200_grants_parity` — grant parity across the RPC surface.
- `20260717002300_fix_profile_role_escalation` — block self role-escalation on profiles.
- `20260717002400_backtest2_hardening` — round-2 adversarial hardening.
- `20260717002500_dispatch_plausible` — dispatch skips implausible/teleporting couriers.
- `20260717002600_restaurant_courier_location` — restaurant reads assigned courier position for pickup.
- `20260718000000_platform_foundation` — notifications/payments/onboarding/UX: push_subscriptions, payment_intents, payouts, onboarding_applications, kyc, start/confirm_online_payment.
- `20260718000100_set_order_tip` — set_order_tip RPC.
- `20260718000200_notification_outbox` — durable notification_outbox + drain cron.
- `20260725000000_search_menu_items` — cross-restaurant search_menu_items RPC.
- `20260725000100_money_integrity` — payout_orders ledger, delivery-payment gate, start_online_payment.
- `20260725000200_restaurant_platform_columns_guard` — is_active guard on restaurant/platform columns.
- `20260725000300_money_integrity_2` — clawback-on-refund, catering confirm tip-on-top.
- `20260725000400_wave4_correctness` — hours gate in place_order, address ownership, atomic outbox claim.
- `20260725000500_master_audit_remediation` — tip freeze after online capture, pending_capture escape, overnight hours, admin_update_payment_status matrix.
- `20260725000600_wave9_backlog` — backlog fixes wave 9.
- `20260725000700_wave9b_payout_lock` — advisory-locked payout generation (no double payout).
- `20260726000000_checkout_idempotency` — place_order idempotency_key + frozen confirm amount.
- `20260726000100_menu_modifiers` — menu_option_groups/options + order_items.selected_options + place_order recompute.
- `20260726000200_customer_push_outbox` — delivery_status_events trigger → customer status pushes via outbox.
- `20260726000300_confirm_online_payment_service_gate` — confirm_online_payment gated to service-role/admin (self-confirm exploit closed).
- `20260726000400_admin_reassign_courier` — admin_reassign_courier RPC (honest rescue for a ghosting courier).
- `20260726000500_gdpr_retention` — purge_expired_pii cron + erase_customer_pii (right to erasure).
- `20260726000600_catering_requote` — partner can re-quote while quote_status in (requested,quoted) & order pending_restaurant.
- `20260727000000_fk_covering_indexes` — 12 FK covering indexes + notification_outbox deny-all RLS note.
- `20260727000100_money_column_checks` — `>= 0` CHECKs on orders/order_items/catering money columns.
- `20260727000200_gdpr_retention_align` — GPS 2yr, dormant 3yr anonymize (orders kept 10yr fiscal), old order-note scrub.
- `20260727000300_payout_immutability` — paid payouts + their payout_orders frozen by trigger (corrections = new transactions).
- `20260727000400_pricing_config` — versioned immutable commission history + set_pricing_config (announces via outbox).
- `20260727000500_courier_suspension` — EU 2024/2831 human-in-loop suspend/reinstate_courier + courier_suspensions.
- `20260727000600_dispatch_scoring_config` — master-audit Faza 3 #3: versioned `dispatch_scoring_config` (alpha0/alpha1/alpha2, admin-only, immutable-history, mirrors `pricing_config`) + `dispatch_order` rewired to read alpha0/alpha1 live instead of hardcoded 1x/10x; alpha2 reserved for Faza 4 NSGA-II tuning.
- `20260727000700_courier_pilot_kpis` — master-audit Faza 5 #5: `courier_shifts` (one row per online→offline session, RPC-only via extended `set_courier_online_status`) + `courier_satisfaction_surveys` (weekly 1-5 pulse, `submit_courier_satisfaction`, immutable/idempotent like ratings) + `close_stale_courier_shifts` safety-net cron (16h cap) + `admin_courier_pilot_kpis` view (satisfaction avg 4w, median gross/shift 14d) for the go/no-go KPI table.
- `20260727000800_cash_float` — order 1 (pilot-critical): `cash_policy` versioned/immutable (mirrors `pricing_config`, seeded provisional cap 1500/reactivation 1000 MDL, `set_cash_policy` setter) + `courier_cash_movements` append-only ledger (RPC-only; CHECK enforces collected>0/offload<0) + accrual added to `advance_delivery_status` (ONLY `payment_method='cash'`, never `card_on_delivery`) + hard-cap gate added to `set_courier_online_status` (blocks going online at/above the LOWER reactivation threshold — hysteresis vs. the cap) + `enforce_cash_cap_offline` trigger (auto-offline + closes shift/declines live offer the instant a collection hits the cap) + `get_courier_cash_status`/`admin_courier_cash_status` read surfaces + `record_cash_offload` (admin-only, mirrors `suspend_courier`).
- `20260727000850_cash_float_fix` — adversarial-review fix: `set_courier_online_status`'s reactivation gate guarded on `v_policy is not null` (whole composite row), which Postgres evaluates true only if EVERY field is non-null; `cash_policy.created_by` is a nullable FK and NULL on the seeded v1 row, so the gate silently never fired — a courier at/above the cap could always go back online. Fixed to guard on the scalar `v_policy.reactivation_threshold_mdl is not null` instead. (`enforce_cash_cap_offline` was unaffected — it already used a scalar.)
- `20260727000900_courier_tariff` — order 2 (pilot-critical): `courier_tariff_config` versioned/immutable rate card (mirrors `pricing_config`, seeded provisional base 30 + 6/km + 1.50/min-wait-after-3min, `set_courier_tariff` setter announces via outbox) + `current_courier_tariff()` internal-only getter + `orders.courier_fee_quoted_mdl`/`courier_fee_mdl` columns — quote (a FLOOR) stamped in `mark_ready_for_pickup` (base + per_km × haversine restaurant→delivery), final stamped in `advance_delivery_status` at delivered (`greatest(quote, live-tariff recompute)` — wait accrual is 0 until `orders.courier_arrived_restaurant_at` ships) + `admin_generate_payouts` recreated with every courier-block `delivery_fee_mdl` reference swapped to `coalesce(courier_fee_mdl, delivery_fee_mdl)` (restaurant-block references deliberately untouched).
- `20260727001000_arrival_clock` — order 3 (observe-only, NO auto-compensation — cut in review): `orders.courier_arrived_restaurant_at` + `courier_arrived_at_restaurant()` RPC (assigned courier only, idempotent, only in status `courier_assigned`); BUG-FIX — `admin_reassign_courier` recreated to NULL the clock on reassign (else the rescuing courier inherits a stale clock + idempotency lockout); `advance_delivery_status` verified unchanged (its wait-term is a hardcoded `0`, not a broken conditional — correct per this task's observe-only directive); `admin_order_board` gets 2 additive columns + new `admin_wait_metrics` view (avg_wait_minutes_7d, avoidable_wait_orders_7d) + one `/platform` KPI tile; courier UI: "Am ajuns la restaurant" button + client-side elapsed timer (no money).
- `20260727001100_avoidable_wait` — order 4 (observe-only, NO auto-compensation): `platform_settings.avoidable_wait_grace_minutes` (default 5) + `current_avoidable_wait_grace_minutes()` SECURITY DEFINER reader granted to authenticated (MANDATORY fix — `platform_settings` RLS is admin-only, so a direct `security_invoker` read would silently return zero rows for partners); recreates `admin_wait_metrics` to use the real grace instead of a placeholder literal; `restaurant_wait_kpis` view (`security_invoker`, explicit `has_restaurant_access` scoping) — reject-rate, prep-accuracy, avg courier wait (from the arrival clock), avoidable-wait-orders, all 30d rolling; `set_prep_time_estimate()` merchant prep-time override editable ONLY pre-accept (Glovo model); `accept_order` recreated to prefer the override over `get_prep_estimates()`; UI: editable prep-time field on the restaurant order queue row (pre-accept) + KPI chip row on `/restaurant/orders` from `restaurant_wait_kpis`.
- `20260727001200_geofence_events` — order 5 (soft hint only, NEVER delivery proof, zero coupling to `advance_delivery_status`): append-only `geofence_events` (order/courier/kind pickup|dropoff/lat/lng/dist_m), RLS courier-own-read + admin-read (no client write policies), append-only enforced by a trigger (update always blocked, delete blocked except for the purge's >2yr rows) mirroring `courier_cash_movements`; `record_geofence_event()` RPC (assigned-courier-only, reuses `haversine_km`/`current_courier_id()`, recomputes dist_m server-side against the order's restaurant/address point) — MANDATORY (phoenix): `purge_expired_pii()` recreated from its current body (`20260727000200`) adding a 2-year `geofence_events` delete (precise GPS PII, same class as `courier_locations`); UI: `DeliveryStatusControls` shows a discreet proximity chip (reusing `pickupPoint`/`dropoffPoint` already computed for `CourierRouteMap` + the shared `haversineM`) and fires the RPC (fire-and-forget, best-effort) on an arrive-press within 150m.
- `20260727001300_dispatch_anonymity` — order 6: `dispatch_order()` recreated from its current body with the `(1-acceptance_rate)*alpha1` reject-penalty term AND its `acc` lateral-join subquery DELETED OUTRIGHT (structural removal, not zero-weighting) — score is now ETA-to-restaurant only (`alpha0`); `alpha1`/`alpha2` stay admin-tunable columns on `dispatch_scoring_config` but nothing reads `alpha1` anymore. `is_plausible` GPS filter and all wave/capacity/lock guards unchanged.
- `20260727001400_ghost_auto_offline` — order 7: `couriers.consecutive_ignored_offers` (streak of consecutive EXPIRED/ignored offers — declines never touch it); `expire_dispatch_offers()` recreated to increment it per expiry and, at N=3, auto-demote the courier offline inline/SECURITY DEFINER (mirrors `set_courier_online_status('offline')`'s state changes exactly: close open shift, decline any live offer, status offline) + queues a `notification_outbox` row (`tag='dispatch'`); `accept_dispatch_offer`/`set_courier_online_status` recreated to reset the streak to 0 on a fresh accept or a manual online toggle respectively.
- `20260727001500_kpi_median_filter` — order 11 closeout: `admin_courier_pilot_kpis` view recreated to exclude "blip" shifts (`orders_count=0`) from `median_gross_per_shift_14d`/`avg_orders_per_shift_14d` (via `FILTER (WHERE earn.orders_count > 0)` on the ordered-set/avg aggregates) while `shifts_14d` keeps counting them raw and a new `empty_shifts_14d` column surfaces the excluded count instead of hiding it.
- `20260727001600_rls_fast_path` — RLS fast-path (measured 179ms→9ms in Supabase docs): EVERY RLS policy in `public` + `storage.objects` (80 total, from the live `pg_policies` catalog, not hand-retyped from old migration files) dropped and recreated with identical qual/with_check semantics plus two mechanical rewrites — (1) every bare `auth.uid()` wrapped `(select auth.uid())` so it's an initPlan evaluated once per statement instead of once per row; (2) every policy gets an explicit `TO authenticated`, or `TO authenticated, anon` on the 8 policies backing the anonymous restaurant/menu browse surface (`restaurants_public_read`, `restaurant_hours_public_read`, `prep_stats_public_read`, `menu_categories_public_read`, `menu_items_public_read`, `menu_option_groups_public_read`, `menu_options_public_read`, `storage.restaurant_photos_public_read` — verified against `src/app/(customer)/restaurants/**` and the `SECURITY INVOKER` RPCs `get_prep_estimates`/`search_menu_items`/`nearby_restaurants`). Helper functions (`has_role`/`has_restaurant_access`/`current_courier_id`/etc.) untouched. Verified: anon gets a planner-level `One-Time Filter: false` (zero qual execution) on protected tables; customer/courier/partner/admin scoping unchanged (`tests/rpc/29_rls_fast_path.sql`).
- `.env.local` holds `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (real, gitignored). `SUPABASE_SERVICE_ROLE_KEY` intentionally absent until needed by admin invite flows (`src/lib/supabase/admin.ts` throws without it).
- `NEXT_PUBLIC_*` vars are inlined at build time — changing `.env.local` requires rebuild + server restart.
- Test account: `client@test.md` / `parola123`. SQL-created auth users need token columns set to `''` not NULL, else GoTrue 500s on login.

## Architecture — the rules that hold everything together

**One app, three surfaces, RLS is the security boundary.** Route groups `(customer)`, `(courier)`, `(admin)` + `(marketing)` share one Supabase backend. `src/proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`; export is `proxy`) role-gates `/deliveries/*`, `/restaurant/*`, `/platform/*` — but that's UX only; Postgres RLS via `has_role()` / `has_any_role()` / `has_restaurant_access()` (SQL functions, migration 000000/000200) is the real enforcement.

**Order status never changes via client `.update()`.** All transitions go through `security definer` RPCs (migration 000500): `place_order`, `accept_order`, `reject_order`, `mark_ready_for_pickup`, `assign_courier`, `advance_delivery_status`, `set_courier_online_status`, `cancel_order`, `submit_catering_quote`, `decline_catering_quote`, `confirm_catering_quote`. Every RPC must check BOTH transition validity AND caller authorization (security definer bypasses RLS — skipping the auth check is the classic bug here). Order lifecycle: `pending_restaurant → accepted → ready_for_pickup → courier_assigned → picked_up → en_route → delivered` (+ `cancelled`/`rejected`). Catering is quote-first (`catering_details.quote_status`), then joins the same pipeline. `delivery_status_events` has deliberately NO insert policy — only RPCs write it. Simple toggles (e.g. `menu_items.is_available`) are fine as direct writes under RLS.

**Roles**: `customer` (self-signup, trigger `handle_new_customer_signup` auto-creates profile), `courier` (needs `profiles.role='courier'` AND a `couriers` row — RPCs look up `couriers`, not `profiles`), `restaurant_partner` (+ `restaurant_staff` link), `platform_admin` (invites others via service-role in Server Actions).

**Ultradeep research-driven subsystems (added 2026-07-17, all applied local+remote, verified via rolled-back JWT-claim sims):**
- **WS2 dispatch** (migration `20260717001600`): push model over the pull model. `dispatch_offers` table (RPC-only writes; partial unique indexes = one live offer per order AND per courier, never re-offer same courier). Engine `dispatch_order()` scores candidates = haversine ETA-to-restaurant by vehicle speed + 14d acceptance penalty (missing GPS/geocode → 6km default). `accept_dispatch_offer` does the atomic claim (compare-and-set `WHERE status='ready_for_pickup' AND courier_id IS NULL`) — serializes vs pull `assign_courier`, no double-assign. `decline_dispatch_offer` cascades. `expire_dispatch_offers()` sweeper on pg_cron `'15 seconds'` (seconds-granularity confirmed on this project) expires 30s offers + cascades (max 5 waves) + rescues undispatched orders. `courier_has_capacity()` is the single capacity source (WS5 batching swaps only its body). `mark_ready_for_pickup`/`assign_courier`/`cancel_order` were recreated preserving WS1 bodies + offer hooks. `restaurants.lat/lng` added (nullable; PostGIS/WS3 later). Courier UI: `OfferCard` (30s countdown) + `OffersLive` (row-filtered realtime).
- **WS4 dynamic ETA** (migration `20260717001400`): `restaurant_prep_stats` (rolling 28d avg/p90 accepted→ready, hour-of-day bucketed) refreshed by `refresh_prep_stats()` on pg_cron `'*/15 * * * *'`; `get_prep_estimates(uuid[])` security-invoker reader with hourly≥5→overall≥5→static fallback; `accept_order` stamps `orders.estimated_ready_at`. UI: `PrepCountdown`, `ReadyTargetBadge`, live estimates on browse/menu/queue.
- **WS6 ratings** (migration `20260717001500`): `ratings` table (RPC-only writes, scoped-select RLS) + denormalized `rating_avg`/`rating_count` on `restaurants`+`couriers`; `submit_rating()` enforces caller=customer + delivered + 30d window + one-per-order-per-target + idempotent. UI: `RatingForm` on delivered tracking; real star avg on cards.
- **WS8 accept-SLA UI**: `SlaCountdown` (partner pill + customer line) from `restaurants.accept_sla_minutes` (WS1).
- **WS10 GPS fraud** (migration `20260717001700`): `fraud_flags` table (append-only from trigger, admin-read/review RLS). `check_gps_plausibility()` BEFORE UPDATE trigger on `courier_locations` flags >150 km/h haversine movement (signal only, never blocks; 0.3km + 5s floors, 5-min debounce). Also fixed a latent bug — `courier_locations.updated_at` never advanced on upsert (added the missing `set_updated_at` trigger). Admin UI at `/platform/fraud`.
- **WS7 admin ops** (migration `20260717001800`): 5 `security_invoker` views (admin_order_board / admin_stuck_orders / admin_fleet_status / admin_restaurant_kpis / admin_payment_queue) — RLS is the boundary, so platform_admin needs read-all on every underlying table (added `restaurants_admin_read`). `admin_update_payment_status` RPC (guarded transition matrix + audit). couriers+courier_locations in the realtime publication. `subscribeTable` filter is optional ONLY for the admin ops surface. UI: `/platform` (KPI tiles + kanban `OrdersBoard` + `FleetPanel` + zero-dep SVG `OpsMap` + realtime `OpsLive` w/ 30s poll fallback), `/platform/queues` (stuck + payment disputes). proxy gates the exact `/platform` too.
- **WS3 real geo** (migration `20260717001900`): PostGIS 3.3.7 in the `extensions` schema (always call `extensions.st_*`), generated `geography` columns + GiST on restaurants/addresses/courier_locations (numeric lat/lng stay the writable source). `nearby_restaurants` public RPC (distance-sorted browse); `courier_dispatch_distance_m` + `nearby_available_couriers` internal (revoked from anon/auth — location privacy). `courier_location_guard` trigger: Moldova-bounds hard-reject + `is_plausible` teleport flag. `assign_courier` got a fail-open >15km distance guard. Restaurants backfilled with demo coords (verify real ones before launch). Frontend: `useNearbyRestaurants` (soft geolocation, fail-open), distance badges.
- **Hardening** (migration `20260717002000`, from adversarial backtest wf_a6f1042e): confirm_catering_quote transition guard; `guard_rating_columns` trigger (SECURITY INVOKER — reverts client writes to `restaurants/couriers.rating_avg/rating_count`, only the definer submit_rating may move them); courier-row FOR UPDATE lock in accept_dispatch_offer/assign_courier (capacity TOCTOU); unique_violation guards in the dispatch sweeper; admin_stuck_orders scoped to standard orders; in_state_since = entry-into-current-status.
- **FIXED (shipped 2026-07-17, doc synced 2026-07-26)**: courier GPS channel `order:{id}:location` is PRIVATE — migration `20260717002100_ws3b_private_location_channel.sql` (`realtime.messages` RLS: only the order's customer / assigned courier / admin can receive; only the assigned courier can send) + `courierLocation.ts` sets `private: true` and calls `setAuth()` on both web and mobile clients. Browser E2E confirmation still pending (see `.bucla/issues.md`).
- **Deferred**: WS5 batching (rewrites assign/advance/cancel — 3-way overlap with shipped WS2, post-MVP), WS9 NATIVE push only (FCM/APNs via EAS creds — Web Push already shipped: `web-push` dep + `public/sw.js` + `PushOptIn` + notification outbox migration `20260718000200` + `/api/push/drain`), checkout pin-drop UI. Remove `/enter/[role]` before launch.

**Realtime** (`src/lib/realtime/`): postgres_changes subscriptions are always row-filtered (`id=eq.X`), never whole-table, and channel names must be unique per mount (`purpose:timestamp-random`) — static names break on React re-mounts. Courier live GPS uses Broadcast channel `order:{id}:location` (~10s ticks) + low-frequency UPSERT to `courier_locations` (~45s) for last-known position. `dispatch_offers` is in the realtime publication (courier offer feed).

**Conventions**: Server Components fetch data; mutations are Server Actions (`actions.ts` per route) returning `{error: string|null}` for `useActionState`; hand-written domain types in `src/lib/types/domain.ts` mirror the schema (regenerate real types via `scripts/gen-types.sh` once local Supabase exists). Cart is Zustand + localStorage (`src/lib/orders/cart.ts`), one restaurant per cart. Menu photos: client-side canvas compression (`src/lib/storage/uploadMenuPhoto.ts`) → bucket `restaurant-photos`, path `{restaurantId}/...` (first path segment drives storage RLS). Brand palette (navy `#0d0d1f`, red `#e94560`, gold `#f5a623`) defined in `globals.css` tokens.

**`mobile/`** — two vendored Expo/React Native apps (client + driver), both LIVE on Supabase via each app's `src/lib/api.ts` adapter; own toolchain, excluded from Next.js tsconfig/eslint. Don't import between `mobile/` and `src/`.

## Status

All surfaces functional on live data (web 3 surfaces + 2 mobile apps), Dragons Alliance Premium design system, full order+catering lifecycle proven E2E. Loop memory: `.bucla/` (scores with evidence) + `docs/LOOP_STATE.md` + `docs/architecture.md`. Known debt: `/enter/[role]` demo doorway — REMOVE before public launch. Deploys only with explicit user confirmation.
