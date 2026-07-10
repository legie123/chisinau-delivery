#!/usr/bin/env bash
set -euo pipefail

# Regenerates src/lib/types/database.types.ts from the local Supabase instance.
# Requires `npx supabase start` to be running.

cd "$(dirname "$0")/.."
npx supabase gen types typescript --local > src/lib/types/database.types.ts
echo "Wrote src/lib/types/database.types.ts"
