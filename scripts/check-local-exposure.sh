#!/usr/bin/env bash
# Fails if any local service of this project listens on all interfaces (reachable from the LAN).
# In dev these are unauthenticated by design (autologin, passwordless /master, Studio SQL,
# default DB password), so loopback-only is the security boundary, not a nicety.
# Ports: app 3000/3007, OSRM 5010, Supabase 54421-54429.
set -u
exposed=$(lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null \
  | awk '{print $9}' | grep -E '^(\*|0\.0\.0\.0|\[::\]):(3000|3007|5010|5442[0-9])$' | sort -u || true)
if [ -n "$exposed" ]; then
  echo "FAIL: listening on all interfaces (reachable from the LAN):" >&2
  echo "$exposed" | sed 's/^/  /' >&2
  echo "  fix: app -> '-H 127.0.0.1'; supabase -> 'supabase stop && bash scripts/supabase-up.sh'" >&2
  exit 1
fi
echo "PASS: no project port listens beyond loopback."
