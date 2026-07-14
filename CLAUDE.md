# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Project

Chișinău Delivery — food-delivery platform (sushi/fine-dining + catering) for Chișinău, Moldova. Currency MDL, UI in Romanian. Next.js 16 App Router + Supabase (Postgres/RLS/Realtime/Auth/Storage).

## LOOP RULE (mandatory working mode)

Every non-trivial task in this repo runs as a loop, not a one-shot: define END-STATE (verifiable) + SCOPE + STOP-RULE up front, then iterate Doer → Verifier → Improve.
- **Verifier for this repo** = `npm run build` + `npm run lint` + smoke-test routes over the launchd server (`launchctl kickstart -k gui/501/com.chisinau-delivery.server`, then curl the touched paths) — after EVERY iteration, not at the end. For large changes, add an adversarial review workflow before declaring done.
- **Memory** = one git commit per iteration (atomic, descriptive).
- **Stop** = end-state verified OR 3 iterations OR explicit user stop. Deploys still require explicit user OK.

## Commands

```bash
npm run build        # production build (Turbopack) — must pass before any phase is "done"
npm run lint         # eslint
npm run dev          # dev server
```

- Production server runs as a launchd agent on port 3000 (`com.chisinau-delivery.server`, log `/tmp/chisinau-delivery-server.log`). After a rebuild: `launchctl kickstart -k gui/501/com.chisinau-delivery.server`. Do not kill it ad hoc.
- No test suite yet. Verification = build + lint + manual flows in browser per role.
- Shell quirk on this machine: plain commands can fail with `command not found: _lc` — run via `env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" <cmd>`.

## Backend (Supabase)

- Live project: `rdowjxnuyawhrjppxzuu` (shared with dormant Trade-AI tables — do NOT touch `poly_*`, `polymarket_*`, `gladiator*`, `equity_history`, `syndicate_audits`, etc.).
- Schema lives in `supabase/migrations/` (7 numbered files, order matters: couriers before orders). Migrations have been applied remotely via MCP `apply_migration`; keep local files and remote in sync.
- `.env.local` holds `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (real, gitignored). `SUPABASE_SERVICE_ROLE_KEY` intentionally absent until needed by admin invite flows (`src/lib/supabase/admin.ts` throws without it).
- `NEXT_PUBLIC_*` vars are inlined at build time — changing `.env.local` requires rebuild + server restart.
- Test account: `client@test.md` / `parola123`. SQL-created auth users need token columns set to `''` not NULL, else GoTrue 500s on login.

## Architecture — the rules that hold everything together

**One app, three surfaces, RLS is the security boundary.** Route groups `(customer)`, `(courier)`, `(admin)` + `(marketing)` share one Supabase backend. `src/proxy.ts` (Next 16 renamed `middleware.ts` → `proxy.ts`; export is `proxy`) role-gates `/deliveries/*`, `/restaurant/*`, `/platform/*` — but that's UX only; Postgres RLS via `has_role()` / `has_any_role()` / `has_restaurant_access()` (SQL functions, migration 000000/000200) is the real enforcement.

**Order status never changes via client `.update()`.** All transitions go through `security definer` RPCs (migration 000500): `place_order`, `accept_order`, `reject_order`, `mark_ready_for_pickup`, `assign_courier`, `advance_delivery_status`, `set_courier_online_status`, `cancel_order`, `submit_catering_quote`, `decline_catering_quote`, `confirm_catering_quote`. Every RPC must check BOTH transition validity AND caller authorization (security definer bypasses RLS — skipping the auth check is the classic bug here). Order lifecycle: `pending_restaurant → accepted → ready_for_pickup → courier_assigned → picked_up → en_route → delivered` (+ `cancelled`/`rejected`). Catering is quote-first (`catering_details.quote_status`), then joins the same pipeline. `delivery_status_events` has deliberately NO insert policy — only RPCs write it. Simple toggles (e.g. `menu_items.is_available`) are fine as direct writes under RLS.

**Roles**: `customer` (self-signup, trigger `handle_new_customer_signup` auto-creates profile), `courier` (needs `profiles.role='courier'` AND a `couriers` row — RPCs look up `couriers`, not `profiles`), `restaurant_partner` (+ `restaurant_staff` link), `platform_admin` (invites others via service-role in Server Actions).

**Realtime** (`src/lib/realtime/`): postgres_changes subscriptions are always row-filtered (`id=eq.X`), never whole-table, and channel names must be unique per mount (`purpose:timestamp-random`) — static names break on React re-mounts. Courier live GPS uses Broadcast channel `order:{id}:location` (~10s ticks) + low-frequency UPSERT to `courier_locations` (~45s) for last-known position.

**Conventions**: Server Components fetch data; mutations are Server Actions (`actions.ts` per route) returning `{error: string|null}` for `useActionState`; hand-written domain types in `src/lib/types/domain.ts` mirror the schema (regenerate real types via `scripts/gen-types.sh` once local Supabase exists). Cart is Zustand + localStorage (`src/lib/orders/cart.ts`), one restaurant per cart. Menu photos: client-side canvas compression (`src/lib/storage/uploadMenuPhoto.ts`) → bucket `restaurant-photos`, path `{restaurantId}/...` (first path segment drives storage RLS). Brand palette (navy `#0d0d1f`, red `#e94560`, gold `#f5a623`) defined in `globals.css` tokens.

**`mobile/`** — two vendored Expo/React Native apps (client + driver) from Zmocolini/dragons-couriers; own toolchain, excluded from Next.js tsconfig/eslint, still on mock data. Don't import between `mobile/` and `src/`.

## Status

Phases 0–3 done (schema, restaurant admin + menu, customer ordering, courier app + realtime tracking). Phase 4 = catering UI (RPCs already exist). Phase 5 = polish/launch. Deploy target: Vercel — production deploys only with explicit user confirmation.
