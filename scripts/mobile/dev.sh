#!/usr/bin/env bash
# Run Expo dev server for a mobile app against the tunnelled local Supabase.
# Usage: scripts/mobile/dev.sh <driver|client> [--lan|--tunnel]   (default --lan)
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
cd "$(dirname "$0")/../.."

APP="${1:-}"
MODE="${2:---lan}"
case "$APP" in driver | client) ;; *) echo "Usage: $0 <driver|client> [--lan|--tunnel]" >&2; exit 1 ;; esac
case "$MODE" in --lan | --tunnel) ;; *) echo "Mode must be --lan or --tunnel" >&2; exit 1 ;; esac

ENVF=mobile/.tunnel.env
[ -f "$ENVF" ] || { echo "No $ENVF. Run scripts/mobile/tunnel.sh first." >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENVF"
set +a
AGE=$(($(date +%s) - ${TUNNEL_STARTED_EPOCH:-0}))
if [ "$AGE" -gt $((${TUNNEL_TTL_MIN:-90} * 60)) ]; then
  echo "Tunnel env is older than its TTL (${TUNNEL_TTL_MIN:-90} min). Re-run tunnel.sh." >&2
  exit 1
fi
: "${EXPO_PUBLIC_SUPABASE_URL:?missing}" "${EXPO_PUBLIC_SUPABASE_ANON_KEY:?missing}"

echo "Starting $APP ($MODE) -> $EXPO_PUBLIC_SUPABASE_URL"
echo "Open the installed DEV CLIENT on the phone and scan the QR below (Expo Go cannot run this app)."
cd "mobile/$APP"
# --clear: the Metro transform cache is not keyed on EXPO_PUBLIC_*, so without it a
# previous run's (dead) tunnel URL can stay inlined in the bundle.
exec npx expo start --dev-client --clear "$MODE"
