#!/usr/bin/env bash
# Start the local Supabase stack with every published port on 127.0.0.1 only.
#
# Supabase CLI publishes ports on its own docker network, where the daemon's "ip" default does
# not apply — so Studio (SQL with no auth), Postgres (password "postgres"), Mailpit (magic links)
# and Kong were reachable from the Wi-Fi (found 2026-10-02). `supabase stop` deletes that network
# and `supabase start` recreates it without the option, so pre-create it here, every time.
#
# Usage: bash scripts/supabase-up.sh      (instead of plain `supabase start`)
set -euo pipefail
cd "$(dirname "$0")/.."
NET=supabase_network_chisinau-delivery

opt=$(docker network inspect "$NET" --format '{{index .Options "com.docker.network.bridge.host_binding_ipv4"}}' 2>/dev/null || true)
if [ "$opt" != "127.0.0.1" ]; then
  if docker network inspect "$NET" >/dev/null 2>&1; then
    echo "✗ $NET exists without loopback binding — run 'supabase stop' first (data stays in volumes)." >&2
    exit 1
  fi
  docker network create \
    --label com.docker.compose.project=chisinau-delivery \
    --label com.supabase.cli.project=chisinau-delivery \
    -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 "$NET" >/dev/null
  echo "▸ created $NET (host binding 127.0.0.1)"
fi

# Rotated JWT secret, read by supabase/config.toml [auth] through env(). Kept outside the repo
# so the mobile tunnel (scripts/mobile/tunnel.sh) never exposes the PUBLIC default secret.
SECRETS="$HOME/.claude/secrets/chisinau-delivery-supabase-jwt.env"
if [ ! -f "$SECRETS" ]; then
  echo "✗ $SECRETS missing. Create it (chmod 600) with one line: the variable named in supabase/config.toml [auth] set to the output of: openssl rand -hex 32" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$SECRETS"
set +a

supabase start
bash scripts/check-local-exposure.sh
