#!/bin/bash
# RPC regression suite (audit #26/#27): every tests/rpc/*.sql file runs wrapped in
# BEGIN/ROLLBACK against the LOCAL Supabase db (superuser; auth simulated via
# request.jwt.claims). Tests self-assert: any FAIL raises an exception → non-zero
# psql exit. Requires: supabase start + the seeded local dataset.
set -u
DB_CONTAINER="supabase_db_chisinau-delivery"
DIR="$(cd "$(dirname "$0")/.." && pwd)/tests/rpc"
fails=0

if ! docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  echo "SKIP: ${DB_CONTAINER} not running (supabase start first)" >&2
  exit 1
fi

for f in "$DIR"/*.sql; do
  name="$(basename "$f")"
  out=$( ( echo "BEGIN;"; cat "$f"; echo "ROLLBACK;" ) | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 2>&1 )
  if [ $? -eq 0 ]; then
    passes=$(printf '%s\n' "$out" | grep -c "PASS")
    echo "✓ $name  (${passes} asserts)"
  else
    fails=$((fails+1))
    echo "✗ $name"
    printf '%s\n' "$out" | grep -E "FAIL|ERROR" | head -5 | sed 's/^/    /'
  fi
done

if [ "$fails" -gt 0 ]; then echo "RPC SUITE: $fails file(s) FAILED"; exit 1; fi
echo "RPC SUITE: all green"
