# Shared types & API — the drift-proof contract layer

The #1 uncontested finding of the Master Council: Next.js and the two Expo apps
each re-declared RPC contracts + status enums by hand, so a migration could silently
diverge one surface from another (the classic "mobile sends a different payload"
bug, surfacing at runtime inside a courier's 30-second offer window). This is the
fix — a workspace of platform-free packages that are the single source of truth.

## Packages

```
packages/
  shared-types/   # @chisinau/shared-types — NO platform deps (no React/Next/Expo)
    src/
      generated.ts    # `supabase gen types` output — NEVER hand-edited
      enums.ts        # OrderStatus, PaymentMethod, PaymentStatus, Role, ...
      transitions.ts  # ADVANCE_TRANSITIONS map + canAdvance/nextAdvanceStatus (contract-tested)
      labels.ts       # ORDER_STATUS_LABEL (Romanian) — one source for every surface
      ids.ts          # branded OrderId / OfferId / CourierId (compile-time safety, 0 runtime)
      index.ts
  shared-api/     # @chisinau/shared-api — typed RPC wrappers
    src/
      errors.ts       # RpcError + mapPgError (uniform Romanian userMessage from PG codes)
      dispatch.ts     # acceptDispatchOffer / declineDispatchOffer / claimOrderAsCourier
      lifecycle.ts    # advanceDeliveryStatus
      index.ts
```

## Non-negotiable rules

1. **`generated.ts` is generated, never edited.** `npm run db:types` after every
   migration. The Supabase clients (`src/lib/supabase/{client,server}.ts`) are typed
   `<Database>`, so every `.from()`/`.rpc()` is schema-checked at build time.
2. **The packages never create the Supabase client — it's passed in.** Next uses
   cookie auth (`@supabase/ssr`), Expo uses SecureStore; instantiating here would
   drag in platform deps. `@supabase/supabase-js` is a `peerDependency` in
   `shared-api` (a bundled copy → two clients → two parallel auth sessions).
3. **No React/Next/Expo imports in the packages, ever** — a duplicated React causes
   a runtime `Invalid hook call` with NO compile error.
4. **`assign_courier` is self-claim only** — its wrapper is named `claimOrderAsCourier`
   with a comment saying so. There is NO admin reassign RPC; building a reassign UI
   needs a new migration first.

## The transitions↔RPC contract (the crown jewel)

`ADVANCE_TRANSITIONS` (TS) is bound to the real `advance_delivery_status` behavior by
two tests that must both stay green:

- `tests/rpc/10_transitions_contract.sql` — exhaustively drives all 72 (from,to)
  status pairs through the REAL RPC and asserts the derived allowed-map equals an
  embedded literal.
- `tests/unit/transitions.test.ts` — asserts the TS map serializes to that SAME literal.

Transitively: **the TS map == the RPC behavior, verified automatically.** This is the
mechanism that replaces "an agent read the RPC body by hand before writing the force-
advance UI" — the drift that twice cost stale known-issues can no longer happen silently.

## The anti-drift gate

`scripts/check-type-drift.sh` (run AFTER `supabase db reset`) regenerates the types and
fails if they differ from what's committed — a schema change without a regen breaks the
build. Wired into `npm run verify` (`check-type-drift → tsc --noEmit → vitest`).

## Promotion path for the Expo apps (later)

The web app consumes the packages today. When the Expo driver/client apps join:
1. Add `mobile/*` to the root `workspaces` array (currently `packages/*`).
2. In each Expo app, replace hand-written status/RPC types with imports from
   `@chisinau/shared-types` / `@chisinau/shared-api`.
3. If Metro can't resolve the workspace package ("Unable to resolve module
   @chisinau/shared-types"), add a `metro.config.js` with `watchFolders =
   [workspaceRoot]`, `nodeModulesPaths` for both locations, and
   `disableHierarchicalLookup = true`. Try without it first.
4. Keep the "packages import no React" rule — it's what makes them safe to share.

This is deliberately NOT done in one big-bang: the web side alone is ~70% of the value,
and moving `src/` or switching to pnpm are orthogonal infra changes to do separately.

## Definition of Done (Council)

- [x] `shared-types` + `shared-api` created; clients typed `<Database>`.
- [x] transitions↔RPC contract test in the permanent suite.
- [x] anti-drift gate script + `npm run verify`.
- [x] representative call-site migrated (courier offer accept/decline via `shared-api`).
- [ ] full sweep: zero `.rpc()` outside `shared-api`, zero local status definitions
      (incremental — migrate call-sites per domain over subsequent rounds).
- [ ] Expo apps consuming the packages (when they join the workspace).
