#!/usr/bin/env bash
# Concurrency gate for dispatch: real parallel sessions on a THROWAWAY clone of the local DB
# (benchdb), never on the working DB. Found the sweeper/accept deadlock fixed in 20261002000200.
#
#   1. claim race   — every active courier calls assign_courier on the same 20 ready orders
#   2. burst load   — 5 placers x 30 orders, partner, sweeper every 200ms, all couriers delivering
#   3. expiry race  — couriers accept within +-30ms of offer expiry while the sweeper spins (x6)
#
# Exit 0 = every invariant held. Usage: bash scripts/concurrency/run.sh   (supabase start first)
set -euo pipefail
cd "$(dirname "$0")"
DB=supabase_db_chisinau-delivery
D=docker

$D ps --format '{{.Names}}' | grep -q "^${DB}$" || { echo "SKIP: ${DB} not running" >&2; exit 1; }
cleanup() { $D exec "$DB" psql -U postgres -qAt -c "drop database if exists benchdb" >/dev/null 2>&1 || true; }
trap cleanup EXIT

echo "▸ cloning local DB into benchdb"
$D exec "$DB" sh -c 'psql -U postgres -qAt -c "drop database if exists benchdb" -c "create database benchdb" \
  && pg_dump -U postgres --exclude-table-data=cron.job_run_details postgres | psql -U postgres -q -o /dev/null benchdb >/dev/null 2>&1'
$D exec -i "$DB" psql -U postgres -q -v ON_ERROR_STOP=1 benchdb < harness.sql
$D cp inner.sh "$DB":/tmp/concurrency-inner.sh
$D exec "$DB" sh /tmp/concurrency-inner.sh
