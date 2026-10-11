#!/usr/bin/env bash
# `supabase status -o env` with the rotated JWT secret loaded.
# supabase/config.toml reads the secret through env(SUPABASE_AUTH_JWT_SECRET). Without it in the
# environment, `supabase status` derives ANON_KEY / SERVICE_ROLE_KEY from the unresolved literal
# and hands every caller keys the running stack rejects (and tunnel.sh a 29-char "secret").
# Every script that reads keys from the local stack goes through here.
set -euo pipefail
cd "$(dirname "$0")/.."
SECRETS="$HOME/.claude/secrets/chisinau-delivery-supabase-jwt.env"
if [ ! -f "$SECRETS" ]; then
  echo "✗ $SECRETS missing (see scripts/supabase-up.sh)" >&2
  exit 1
fi
set -a
# shellcheck disable=SC1090
. "$SECRETS"
set +a
exec env -i HOME="$HOME" PATH="/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin" \
  SUPABASE_AUTH_JWT_SECRET="$SUPABASE_AUTH_JWT_SECRET" supabase status -o env
