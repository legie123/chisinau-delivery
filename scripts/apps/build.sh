#!/usr/bin/env bash
# Production build of one app shell (apps/<app>) against the LOCAL Supabase stack.
# NEXT_PUBLIC_* are inlined at build time, so the env must be present here, not only at start.
#
# Usage:  bash scripts/apps/build.sh restaurant
# Then:   cd apps/restaurant && node ../../node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3003
#         (start needs the same NEXT_PUBLIC_* env: the proxy reads them at runtime).
set -euo pipefail
cd "$(dirname "$0")/../.."

APP="${1:-}"
case "$APP" in
  restaurant|master) ;;
  client|curier) echo "✗ $APP is a native app now: see mobile/ and docs/mobile.md" >&2; exit 2 ;;
  *) echo "usage: bash scripts/apps/build.sh <restaurant|master>" >&2; exit 2 ;;
esac
if [ ! -f "apps/$APP/package.json" ]; then
  echo "✗ apps/$APP does not exist yet" >&2
  exit 1
fi

WRAP=(env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin")
eval "$("${WRAP[@]}" supabase status -o env 2>/dev/null | grep -E '^API_URL|^ANON_KEY')"
if [ -z "${API_URL:-}" ]; then
  echo "✗ Local Supabase isn't running. Start it first:  bash scripts/supabase-up.sh" >&2
  exit 1
fi

cd "apps/$APP"
NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
node ../../node_modules/next/dist/bin/next build
