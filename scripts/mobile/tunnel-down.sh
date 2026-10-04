#!/usr/bin/env bash
# Kill the tunnel + watchdog and remove the env file.
export PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin
cd "$(dirname "$0")/../.." || exit 1
if [ -f mobile/.tunnel.pid ]; then
  # shellcheck disable=SC2013
  for p in $(cat mobile/.tunnel.pid); do kill "$p" 2>/dev/null || true; done
fi
rm -f mobile/.tunnel.pid mobile/.tunnel.env
echo "Tunnel down."
