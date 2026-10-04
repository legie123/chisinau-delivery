#!/usr/bin/env bash
# Short-lived Cloudflare quick tunnel to the LOCAL Supabase API (54421) ONLY — not the
# DB (54422), not Studio (54423). Writes mobile/.tunnel.env, auto-kills after TTL.
# Usage: scripts/mobile/tunnel.sh [ttl_minutes]   (default 90, or TUNNEL_TTL_MIN)
set -euo pipefail
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
cd "$(dirname "$0")/../.."

TTL_MIN="${1:-${TUNNEL_TTL_MIN:-90}}"
case "$TTL_MIN" in '' | *[!0-9]* | 0) echo "TTL must be a positive integer (minutes)" >&2; exit 1 ;; esac
CF=/opt/homebrew/bin/cloudflared
if [ ! -x "$CF" ]; then
  echo "cloudflared missing. Install: brew install cloudflared" >&2
  exit 2
fi

ENVF=mobile/.tunnel.env
PIDF=mobile/.tunnel.pid
LOGF=mobile/.tunnel.log
bash scripts/mobile/tunnel-down.sh >/dev/null 2>&1 || true

eval "$(supabase status -o env 2>/dev/null | grep -E '^ANON_KEY=|^JWT_SECRET=')"
if [ -z "${ANON_KEY:-}" ]; then
  echo "Local Supabase not running. Start it: bash scripts/supabase-up.sh" >&2
  exit 1
fi

# The local stack ships with Supabase's PUBLISHED default JWT secret. Behind a public tunnel that
# means anyone who finds the URL can sign their own service_role token and bypass RLS entirely —
# not "guess", read it from the docs. Refuse unless the secret was rotated (supabase/config.toml
# [auth] jwt_secret = "env(SUPABASE_AUTH_JWT_SECRET)" + restart), or the risk is accepted
# explicitly for this one session.
if [ "${JWT_SECRET:-}" = "super-secret-jwt-token-with-at-least-32-characters-long" ] \
  && [ "${TUNNEL_ACCEPT_DEFAULT_JWT_SECRET:-}" != "1" ]; then
  cat >&2 <<'MSG'
✗ Refusing: the local Supabase uses the PUBLIC default JWT secret. Through a tunnel anyone could
  mint a service_role token and read/write the whole database, bypassing RLS.
  Fix (once): set a random secret in supabase/config.toml under [auth]:
      jwt_secret = "env(SUPABASE_AUTH_JWT_SECRET)"
  export SUPABASE_AUTH_JWT_SECRET="$(openssl rand -hex 32)" (keep it in a gitignored file),
  then: supabase stop && bash scripts/supabase-up.sh   (anon/service keys are re-derived).
  Conscious override for ONE short session: TUNNEL_ACCEPT_DEFAULT_JWT_SECRET=1 scripts/mobile/tunnel.sh
MSG
  exit 3
fi
unset JWT_SECRET

: >"$LOGF"
nohup "$CF" tunnel --no-autoupdate --url http://127.0.0.1:54421 >"$LOGF" 2>&1 &
CF_PID=$!
# Watchdog: kill the tunnel after TTL and remove the env file (safety net).
nohup bash -c "sleep $((TTL_MIN * 60)); kill $CF_PID 2>/dev/null; rm -f '$ENVF' '$PIDF'" >/dev/null 2>&1 &
WD_PID=$!
echo "$CF_PID $WD_PID" >"$PIDF"

URL=""
for _ in $(seq 1 40); do
  URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$LOGF" | head -1 || true)"
  [ -n "$URL" ] && break
  kill -0 "$CF_PID" 2>/dev/null || break
  sleep 0.5
done
if [ -z "$URL" ]; then
  echo "Tunnel did not come up; see $LOGF" >&2
  bash scripts/mobile/tunnel-down.sh >/dev/null 2>&1 || true
  exit 1
fi

umask 077
{
  echo "EXPO_PUBLIC_SUPABASE_URL=$URL"
  echo "EXPO_PUBLIC_SUPABASE_ANON_KEY=$ANON_KEY"
  echo "TUNNEL_STARTED_EPOCH=$(date +%s)"
  echo "TUNNEL_TTL_MIN=$TTL_MIN"
} >"$ENVF"

echo "Tunnel up: $URL  (local API only; auto-kill in ${TTL_MIN} min)"
echo "Env written to $ENVF. Next: scripts/mobile/dev.sh driver|client"
echo "Stop early: scripts/mobile/tunnel-down.sh"
