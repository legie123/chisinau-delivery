#!/usr/bin/env bash
# The 100%-operational LOCAL server for Chișinău Delivery, on :3007.
#
# Targets the LOCAL Supabase stack (NOT the paused shared remote), with the admin
# service key + the private /master doorway enabled. This is the instance to use
# for local operation — one command brings it up (or restarts it) with the full env.
#
# Secrets: the master password is NOT in git. It's read from scripts/.dev-local.env
# (gitignored). Create it once:
#     echo 'export MASTER_DOORWAY_PASS=<your-password>' > scripts/.dev-local.env
# The local Supabase keys are throwaway (per-machine) and read live from the stack.
#
# Routing: OSRM_URL defaults to the self-hosted Moldova router (docker container
# "osrm-chisinau", port 5010, restart unless-stopped — see .osrm/ + docs/onboarding-runbook.md).
# Falls back to the public router.project-osrm.org if unset AND the container isn't running,
# per src/lib/routing/route.ts's own fallback chain.
#
# Usage:  bash scripts/dev-local.sh        (requires: supabase start already run)
set -euo pipefail
cd "$(dirname "$0")/.."

WRAP=(env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin")

# Local Supabase URL / anon / service-role keys from the running local stack.
eval "$(bash scripts/supabase-status.sh 2>/dev/null | grep -E '^API_URL|^ANON_KEY|^SERVICE_ROLE_KEY|^JWT_SECRET')"
if [ -z "${API_URL:-}" ]; then
  echo "✗ Local Supabase isn't running. Start it first:  supabase start" >&2
  exit 1
fi

# Master doorway — username may live in the committed default; password only in the
# gitignored file. The username alone is useless without the password.
export MASTER_DOORWAY_USER="${MASTER_DOORWAY_USER:-dragon}"
# shellcheck disable=SC1091
[ -f scripts/.dev-local.env ] && source scripts/.dev-local.env
if [ -z "${MASTER_DOORWAY_PASS:-}" ]; then
  echo "⚠  MASTER_DOORWAY_PASS not set — the /master login won't work until you create"
  echo "   scripts/.dev-local.env:  echo 'export MASTER_DOORWAY_PASS=<pass>' > scripts/.dev-local.env"
fi

# Clean restart on :3007 (kill by port, not name — avoids stale next-server).
lsof -ti :3007 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1

# Loopback only (-H 127.0.0.1): in dev the proxy auto-logs-in every visitor and /master needs no
# password, so binding all interfaces handed admin to anyone on the Wi-Fi. The pg_net push drain
# still reaches it via host.docker.internal (colima forwards that to the host's loopback).
# NEVER put a comment line inside the backslash-continued env block below: it ends the command,
# the assignments become plain shell vars, and npm starts without them (broke /master, 2026-10-02).
NEXT_PUBLIC_SUPABASE_URL="$API_URL" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="$ANON_KEY" \
SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-}" \
PUSH_DRAIN_SECRET="${PUSH_DRAIN_SECRET:-}" \
SUPABASE_JWT_SECRET="${JWT_SECRET:-}" \
ENABLE_MASTER_DOORWAY="true" \
MASTER_DOORWAY_USER="$MASTER_DOORWAY_USER" \
MASTER_DOORWAY_PASS="${MASTER_DOORWAY_PASS:-}" \
OSRM_URL="${OSRM_URL:-http://localhost:5010}" \
PORT=3007 nohup npm run dev -- -p 3007 -H 127.0.0.1 > /tmp/chisinau-local-3007.log 2>&1 &
disown

echo "▸ Local operational server starting → http://localhost:3007"
echo "  master doorway: http://localhost:3007/master   (user: ${MASTER_DOORWAY_USER})"
echo "  logs: /tmp/chisinau-local-3007.log"
