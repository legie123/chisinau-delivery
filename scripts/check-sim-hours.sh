#!/usr/bin/env bash
# Fails if a SQL sim pins restaurant hours to a window ending at 23:59. restaurant_open_at()
# uses `t between opens_at and closes_at` in Europe/Chisinau, so such a sim places its order
# "now" into a closed restaurant for the last minute of every day and flakes.
# Always-open window: opens_at = closes_at = '00:00' (overnight branch: t >= 00:00, every second).
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="$ROOT/tests/rpc"
# The concurrency harness arranges hours the same way (scripts/concurrency/harness.sql).
hits=$(grep -nE "'23:59(:[0-9]{2})?'" "$DIR"/*.sql "$ROOT"/scripts/concurrency/*.sql || true)
if [ -n "$hits" ]; then
  echo "FAIL: sim restaurant hours end at 23:59 (closed during the last minute of the day):" >&2
  echo "$hits" | sed "s|$ROOT/|  |" >&2
  echo "  fix: use '00:00'::time, '00:00'::time, false (always open)" >&2
  exit 1
fi
echo "PASS: no sim pins restaurant hours to a 23:59 close."
