#!/usr/bin/env bash
# Dev server for one web shell (apps/<app>) against the LOCAL Supabase stack, like
# scripts/dev-local.sh does for the monolith on :3007. Client and courier are NATIVE apps
# (mobile/client, mobile/driver — see docs/mobile.md); only restaurant and master are web shells.
#
# Usage:  bash scripts/apps/dev.sh restaurant          → http://localhost:3003
#         bash scripts/apps/dev.sh master              → http://localhost:3004
#         APP_PORT=3103 bash scripts/apps/dev.sh restaurant   (scratch port override)
# Ports mirror src/lib/apps/registry.ts APP_PORTS — cross-app redirects assume them.
# Browse via localhost, not 127.0.0.1: the auth cookie is host-scoped, and cross-app redirects
# keep the hostname you typed.
set -euo pipefail
cd "$(dirname "$0")/../.."

APP="${1:-}"
case "$APP" in
  restaurant) DEFAULT_PORT=3003 ;;
  master) DEFAULT_PORT=3004 ;;
  client|curier) echo "✗ $APP is a native app now: see mobile/ and docs/mobile.md" >&2; exit 2 ;;
  *) echo "usage: bash scripts/apps/dev.sh <restaurant|master>" >&2; exit 2 ;;
esac
PORT="${APP_PORT:-$DEFAULT_PORT}"

WRAP=(env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin")

# Local Supabase URL / anon / service-role keys from the running local stack (never printed).
eval "$("${WRAP[@]}" supabase status -o env 2>/dev/null | grep -E '^API_URL|^ANON_KEY|^SERVICE_ROLE_KEY|^JWT_SECRET')"
if [ -z "${API_URL:-}" ]; then
  echo "✗ Local Supabase isn't running. Start it first:  bash scripts/supabase-up.sh" >&2
  exit 1
fi

# Master only: the private /master doorway (same env as scripts/dev-local.sh). The doorway
# password lives only in the gitignored scripts/.dev-local.env.
ENABLE_MASTER_DOORWAY="false"
MASTER_DOORWAY_USER="${MASTER_DOORWAY_USER:-dragon}"
VIEW_AS_JWT_SECRET=""
if [ "$APP" = "master" ]; then
  ENABLE_MASTER_DOORWAY="true"
  # View-as ("vezi ca") signs read-only viewer JWTs with the project JWT secret — server-side
  # env only, never NEXT_PUBLIC_*. Locally it is Supabase's published default: rotate it before
  # any exposure (docs/mobile.md). Other shells never receive it.
  VIEW_AS_JWT_SECRET="${JWT_SECRET:-}"
  # shellcheck disable=SC1091
  [ -f scripts/.dev-local.env ] && source scripts/.dev-local.env
fi

# Clean restart (kill by port, not name — avoids stale next-server).
lsof -ti ":$PORT" 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

LOG="/tmp/chisinau-app-$APP-$PORT.log"
cd "apps/$APP"
# Loopback only (-H 127.0.0.1): in dev the proxy auto-logs-in local requests.
# NEVER put a comment line inside the backslash-continued env block below: it ends the command,
# the assignments become plain shell vars, and next starts without them (broke /master, 2026-10-02).
NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}" \
OSRM_URL="${OSRM_URL:-http://localhost:5010}" \
ENABLE_MASTER_DOORWAY="$ENABLE_MASTER_DOORWAY" \
MASTER_DOORWAY_USER="$MASTER_DOORWAY_USER" \
MASTER_DOORWAY_PASS="${MASTER_DOORWAY_PASS:-}" \
SUPABASE_JWT_SECRET="$VIEW_AS_JWT_SECRET" \
nohup node ../../node_modules/next/dist/bin/next dev -H 127.0.0.1 -p "$PORT" > "$LOG" 2>&1 &
disown

echo "▸ apps/$APP dev server starting → http://localhost:$PORT"
echo "  logs: $LOG"
