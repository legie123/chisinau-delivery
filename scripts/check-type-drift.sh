#!/usr/bin/env bash
# Anti-drift gate (Master Council Phase 1, Round 3): regenerate the Supabase types
# and fail if they differ from what's committed — i.e. a migration changed the schema
# but packages/shared-types/src/generated.ts was not regenerated + committed. Run
# AFTER `supabase db reset` so the local DB reflects EVERY migration (otherwise the
# diff is a false negative). Joins the verifier: npm run verify.
set -euo pipefail
cd "$(dirname "$0")/.."

GEN=packages/shared-types/src/generated.ts
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

if ! docker ps --format '{{.Names}}' | grep -q '^supabase_db_chisinau-delivery$'; then
  echo "SKIP: local Supabase not running (supabase start first)"; exit 0
fi

npx --yes supabase gen types typescript --local > "$TMP" 2>/dev/null

if ! diff -q "$GEN" "$TMP" >/dev/null 2>&1; then
  echo "✗ TYPE DRIFT: $GEN is stale vs the live schema."
  echo "  A migration changed the schema without regenerating types."
  echo "  Fix: npm run db:types  (then adapt any consumers the typecheck flags) + commit."
  echo "  --- diff (committed vs live) ---"
  diff "$GEN" "$TMP" | head -40 || true
  exit 1
fi
echo "✓ generated types match the live schema — no drift"
