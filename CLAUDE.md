# CLAUDE.md

Rules for working in this repo. Only things that change a decision live here.
Per-migration detail: `docs/migrations.md`. Why a subsystem exists: `docs/history.md`.
Operational runbook: `docs/GHID-OPERATIONAL.md`.

@AGENTS.md

## Project

Chișinău Delivery — concierge platform for Chișinău, Moldova: food delivery (sushi / fine-dining),
catering, and venue bookings (spa / lounge). Currency MDL, UI in Romanian.
Next.js 16 App Router + Supabase (Postgres / RLS / Realtime / Auth / Storage).

## Working mode (LOOP RULE — mandatory)

Every non-trivial task runs as a loop, not a one-shot: state END-STATE (verifiable) + SCOPE +
STOP-RULE first, then iterate Doer → Verifier → Improve.

- **Verifier** = `npm run verify` + `npm test` + `npm run build` + `npm run test:rpc` + smoke the
  touched routes. After EVERY iteration, not at the end.
- **Memory** = one atomic git commit per iteration. Commit is pre-authorized here; push and deploy
  are NOT — they need explicit user OK every time.
- **Stop** = end-state verified, OR 3 iterations, OR user says stop.
- Loop state lives in `.bucla/` (gitignored) + `docs/LOOP_STATE.md`.

## Commands

```bash
npm run build      # production build (Turbopack) — must pass before anything is "done"
npm run verify     # 4 steps: check-type-drift.sh -> check-doc-drift.sh -> tsc --noEmit -> vitest
npm test           # vitest unit suite — ONLY tests/unit/**/*.test.ts, never the SQL sims
npm run test:rpc   # SQL sims (tests/rpc) — the real behaviour gate. Needs the Docker container
                   # `supabase_db_chisinau-delivery` running, else it prints SKIP and exits 1.
npm run lint       # eslint
npm run dev        # dev server
bash scripts/check-doc-drift.sh   # every migration must have an entry in docs/migrations.md
```

## Environment (this machine)

- **Shell quirk**: plain commands can fail with `command not found: _lc`. Wrap them:
  `env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" bash -c '<cmd>'`
- **:3000** — production-ish server, launchd agent `com.chisinau-delivery.server`, log
  `/tmp/chisinau-delivery-server.log`. After a rebuild: `launchctl kickstart -k
  gui/501/com.chisinau-delivery.server`. Do not kill it ad hoc; kill by port, never by process name
  (stale `next-server` processes survive a name-based kill).
- **:3007** — operational dev server, started by `scripts/dev-local.sh`, master doorway at `/master`.
  `masterPasswordRequired()` is true only in production or with `DISABLE_DEV_AUTOLOGIN=1`, so in dev
  `/master` lets you in **without a password** by default. Self-hosted OSRM router on **:5010** via
  `OSRM_URL`.
- Local Supabase DB port is **54422**, not the 54322 default.
- **Everything local listens on 127.0.0.1 only.** Start Supabase with `bash scripts/supabase-up.sh`,
  never plain `supabase start` (its network would publish Studio/Postgres/Mailpit on the LAN with
  default creds). Apps run with `-H 127.0.0.1`. `npm run verify` fails via
  `scripts/check-local-exposure.sh` if any project port is on 0.0.0.0.
- `NEXT_PUBLIC_*` vars are inlined at build time — changing `.env.local` needs rebuild + restart.
- `.env.local` holds the real Supabase URL + anon key (gitignored). `SUPABASE_SERVICE_ROLE_KEY` is
  deliberately absent until an admin invite flow needs it (`src/lib/supabase/admin.ts` throws without it).
- Test account: `client@test.md` / `parola123`. Auth users created via SQL need token columns set to
  `''`, not NULL, or GoTrue 500s on login.

## Hard rules

1. **RLS is the security boundary, not the proxy.** `src/proxy.ts` (Next 16 renamed
   `middleware.ts` → `proxy.ts`; the export is `proxy`, not `middleware`) role-gates
   `/deliveries/*`, `/restaurant/*`, `/platform/*` — that is UX only. Enforcement is Postgres RLS
   via `has_role()` / `has_any_role()` / `has_restaurant_access()`.
2. **Order status never changes via a client `.update()`.** Every transition goes through a
   `security definer` RPC. `delivery_status_events` has deliberately no insert policy — only RPCs
   write it. Simple flags (e.g. `menu_items.is_available`) may be direct writes under RLS.
3. **A `security definer` function bypasses RLS, so it must check BOTH transition validity AND
   caller authorization.** Skipping the auth check is the classic bug in this repo.
4. **Cross-role writes go through `security definer` triggers/RPCs, never from the client.**
5. **A courier is `profiles.role='courier'` AND a row in `couriers`.** RPCs look up `couriers`, not
   `profiles` — checking the wrong one silently returns "not a courier".
6. **PostGIS lives in the `extensions` schema** — always call `extensions.st_*`. Numeric `lat`/`lng`
   stay the writable source; `geography` columns are generated.
7. **Never touch the dormant Trade-AI tables** in the shared Supabase project `rdowjxnuyawhrjppxzuu`:
   `poly_*`, `polymarket_*`, `gladiator*`, `equity_history`, `syndicate_audits`.
8. **Migrations in `supabase/migrations/` are authoritative.** Applied locally via
   `supabase db reset`; remote sync is a deliberate pre-launch step, never a side effect.
   Order matters (couriers before orders). Every file needs an entry in `docs/migrations.md`.
9. **Recreate a function from its LIVE body** (`pg_get_functiondef` / `pg_get_viewdef`), then apply
   ONE delta. Rewriting from memory has silently dropped working logic here before.

## Order lifecycle

`pending_restaurant → accepted → ready_for_pickup → courier_assigned → picked_up → en_route →
delivered` (+ `cancelled` / `rejected`).

Transition RPCs: `place_order`, `accept_order`, `reject_order`, `mark_ready_for_pickup`,
`assign_courier`, `advance_delivery_status`, `cancel_order`, `restaurant_cancel_order`,
`set_courier_online_status`.
Catering is quote-first (`catering_details.quote_status`: `submit_catering_quote` /
`decline_catering_quote` / `confirm_catering_quote`), then joins the same pipeline.
Venue bookings are a second transaction shape on the same `restaurants` table
(`request_` / `quote_` / `confirm_` / `decline_` / `cancel_venue_booking`) — partner sets the price.

## Money invariants

- `orders.delivery_fee_mdl` is **write-once** — a trigger blocks any post-insert change. It is a
  FLOOR, never re-priced retroactively.
- Payouts read the commission from the `pricing_config` version in effect at the order's
  `delivered_at` (`pricing_config_at`), never the mutable `platform_settings` cache.
- Config tables are **versioned and immutable**: `pricing_config`, `courier_tariff_config`,
  `cash_policy`, `dispatch_scoring_config`. Corrections are new rows, never edits.
- Paid payouts and their `payout_orders` lines are frozen by trigger — a correction is a new
  transaction.
- There are **two different cash caps — do not confuse them**:
  1. **Checkout cap** — `place_order` rejects a `standard` + `cash` order whose total exceeds
     **1400 MDL** ("comenzile peste 1400 MDL se achită cu cardul la livrare"). Catering is exempt.
  2. **Courier float cap** — `effective_cash_cap()` (tenure-tiered) limits how much cash one courier
     may carry; enforced in three places: `courier_has_capacity`, `set_courier_online_status`, and
     the accrual trigger. Catering is exempt here too.
  `courier_cash_movements` is the append-only ledger behind cap 2.
- Money columns on `orders` / `order_items` / `catering_details` carry `>= 0` CHECK constraints.
  `payouts.gross`/`net` are **deliberately excluded** — a clawback net is legitimately negative.
- Business numbers (cash cap, courier tariff, ghost-offline N) are **PROVISIONAL, awaiting founder
  ratification** — treat them as tunable config, never as constants to hardcode.

## Dispatch

- Push model: `dispatch_offers` (RPC-only writes; partial unique indexes = one live offer per order
  and per courier). `dispatch_order()` scores candidates on ETA-to-restaurant only.
- **Dispatch is anonymous by construction** — the reject-penalty term was structurally removed, not
  zero-weighted. Do not reintroduce acceptance-rate scoring: it is an EU 2024/2831 legal constraint,
  not a tuning choice (see `docs/plan/CONSTRANGERI-GAMIFICARE.md`).
- Sweeper `expire_dispatch_offers()` runs on pg_cron every 15s: expires 30s offers, cascades waves,
  rescues undispatched orders. A decline is permanent; an ignored (expired) offer only sidelines the
  courier for 2 min. Three consecutive ignored offers auto-offline the courier.
- Geofence events and POD photos are **soft signals only** — never delivery proof, never gates on
  `advance_delivery_status`.
- Scheduled orders: `dispatch_order` returns null until `requested_for - 45 min`. Anchor SLA and ETA
  clocks on the scheduled window, never on `now()`.

## Realtime

- `postgres_changes` subscriptions are always row-filtered (`id=eq.X`), never whole-table. The only
  exception is the admin ops surface.
- `src/lib/realtime/subscribeTable.ts` generates the channel name per call
  (`${purpose}:${Date.now()}-${random}`). Never pass a fixed string: on a React re-mount Supabase
  throws "cannot add postgres_changes callbacks after subscribe()".
- Courier live GPS is a **private** Broadcast channel `order:{id}:location` (~10s), plus a
  low-frequency upsert to `courier_locations` (~45s). Clients must set `private: true` and call
  `setAuth()`.

## Storage

Path's FIRST segment drives the RLS policy.

- `restaurant-photos` — public read, write gated by `has_restaurant_access`, path `{restaurantId}/…`
- `delivery-proof` — private, path `{orderId}/…`. Append-only for clients (no update/delete policy
  at all), but **not kept forever**: `purge_expired_pii()` deletes these photos after **90 days**.
- `kyc-documents` — private. Rejected applications purged 90d after review, abandoned ones 180d
  after creation; approved (active) ones deliberately retained.
- Anything holding PII is purged on schedule by `purge_expired_pii()` — if you add a PII surface,
  add it to that function in the same migration.

## Frontend conventions

- Server Components fetch; mutations are Server Actions in a per-route `actions.ts`, returning
  `{ error: string | null }` for `useActionState`.
- `params` / `searchParams` are Promises (Next 16).
- Hand-written domain types in `src/lib/types/` mirror the schema; generated types land in
  `packages/shared-types/src/generated.ts` via `npm run db:types`.
- Cart is Zustand + localStorage persist (`src/lib/orders/cart.ts`), one restaurant per cart.
- Menu photos: client-side canvas compression before upload (`src/lib/storage/`).
- Every user-facing string is Romanian, including errors.

## Mobile

`mobile/client` and `mobile/driver` — two vendored Expo/React Native apps, live on Supabase through
each app's own `src/lib/api.ts`. Separate toolchain, excluded from the Next tsconfig/eslint.
Never import across `mobile/` ↔ `src/`. The driver app's map coordinates are still synthetic.

## If you touch X, you must also do Y

| Change | Also required |
|---|---|
| new migration | entry in `docs/migrations.md`; a sim in `tests/rpc/` that FAILS without the fix |
| new sim in `tests/rpc/` | plain SQL, no assertion framework: `scripts/test-rpc.sh` wraps each file in `BEGIN;`/`ROLLBACK;` and pipes it to psql with `ON_ERROR_STOP=1`, so a failing assertion is just a `raise exception`. One file usually holds several sims |
| new table | explicit `GRANT` + RLS policy (a new table is unreachable without both) |
| new PII column/bucket | add it to `purge_expired_pii()` in the same migration |
| recreate an RPC/view | copy the live body first, then apply one delta |
| new i18n string | Romanian, no English leakage into user-facing text |
| new cron function | `statement_timeout` via `ALTER FUNCTION` (a `CREATE OR REPLACE` drops it) |
| RPC signature change | `drop function` explicitly — `create or replace` leaves the old signature alive and calls become ambiguous |
| touching money | a rolled-back sim proving the invariant, not just a build |

## Counted facts

Generated by `scripts/facts.sh` — do not hand-edit. Stale numbers here fail `check-doc-drift.sh`.

<!-- FACTS:BEGIN -->
- Migrations: **105** files (20260708 → 20261003), indexed in `docs/migrations.md` (**106** entries).
- Distinct SQL functions: **112**. Reporting/admin views: **16**.
- Test FILES (not assertion counts): **72** in `tests/rpc/`, **29** in `tests/unit/`.
  Each holds several assertions — run the suites for real counts.
- Surfaces: web route groups `(customer) (courier) (admin) (marketing)` + 2 Expo apps in `mobile/`.
<!-- FACTS:END -->

## Known debt

- `/enter/[role]` — passwordless role-login doorway. It is already production-gated (the route
  checks `NODE_ENV === 'production'` and redirects to `/login`), so it is dev/staging-only by
  construction — but still delete it before public launch rather than trusting one `if`.
- Restaurant coordinates are demo values; verify real ones before launch.
- Mobile driver map coordinates are synthetic.
- Deploys happen only with explicit user confirmation.
