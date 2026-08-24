#!/usr/bin/env bash
# Counted facts for CLAUDE.md, generated from the filesystem.
#
# Why this exists: the numbers in CLAUDE.md were hand-written and drifted three
# separate times (the doc claimed "34 RPC sims" while 66 files existed on disk;
# .bucla/state.json claimed a third number). A number a human types is a number
# that goes stale. This regenerates them and can fail a gate when they are.
#
#   scripts/facts.sh           rewrite the block between the FACTS anchors in CLAUDE.md
#   scripts/facts.sh --check   exit 1 if the block is stale (no write)
#   scripts/facts.sh --print   print the block only
#
# The block is delimited in CLAUDE.md by:
#   <!-- FACTS:BEGIN -->  ...  <!-- FACTS:END -->
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_MD="$ROOT/CLAUDE.md"
BEGIN='<!-- FACTS:BEGIN -->'
END='<!-- FACTS:END -->'

count_files() { ls $1 2>/dev/null | wc -l | tr -d ' '; }

gen_block() {
  local migrations sims unit_files unit_cases rpcs views index_entries oldest newest
  migrations="$(count_files "$ROOT/supabase/migrations/*.sql")"
  sims="$(count_files "$ROOT/tests/rpc/*.sql")"
  unit_files="$(count_files "$ROOT/tests/unit/*.ts")"
  # NOTE: no test-CASE count here on purpose. A static grep cannot produce it —
  # `it.each([...])` expands at runtime, so grep says 170 where vitest says 206.
  # A number that cannot be computed correctly does not get published; run
  # `npm test` when you need the real case count.
  rpcs="$(grep -rhoE 'create or replace function public\.[a-z_]+' "$ROOT/supabase/migrations"/*.sql 2>/dev/null | sed 's/.*public\.//' | sort -u | wc -l | tr -d ' ')"
  views="$(grep -rhoE 'create (or replace )?view public\.[a-z_]+' "$ROOT/supabase/migrations"/*.sql 2>/dev/null | sed 's/.*public\.//' | sort -u | wc -l | tr -d ' ')"
  index_entries="$(grep -cE '^- `' "$ROOT/docs/migrations.md" 2>/dev/null | tr -d ' ')"
  oldest="$(ls "$ROOT/supabase/migrations" 2>/dev/null | grep -oE '^[0-9]{8}' | sort | head -1)"
  newest="$(ls "$ROOT/supabase/migrations" 2>/dev/null | grep -oE '^[0-9]{8}' | sort | tail -1)"

  printf '%s\n' "$BEGIN"
  printf -- '- Migrations: **%s** files (%s → %s), indexed in `docs/migrations.md` (**%s** entries).\n' \
    "$migrations" "$oldest" "$newest" "$index_entries"
  printf -- '- Distinct SQL functions: **%s**. Reporting/admin views: **%s**.\n' "$rpcs" "$views"
  printf -- '- RPC sims: **%s** files in `tests/rpc/`. Unit test files: **%s** in `tests/unit/`.\n' \
    "$sims" "$unit_files"
  printf -- '- Surfaces: web route groups `(customer) (courier) (admin) (marketing)` + 2 Expo apps in `mobile/`.\n'
  printf '%s\n' "$END"
}

extract_block() {
  awk -v b="$BEGIN" -v e="$END" '
    $0 == b {inb=1} inb {print} $0 == e {inb=0}
  ' "$CLAUDE_MD"
}

if [[ ! -f "$CLAUDE_MD" ]]; then
  echo "ERROR: $CLAUDE_MD not found" >&2
  exit 2
fi
if ! grep -qF "$BEGIN" "$CLAUDE_MD" || ! grep -qF "$END" "$CLAUDE_MD"; then
  echo "ERROR: FACTS anchors missing from CLAUDE.md" >&2
  exit 2
fi

case "${1:---write}" in
  --print) gen_block ;;
  --check)
    if diff -q <(extract_block) <(gen_block) >/dev/null; then
      echo "PASS: counted facts in CLAUDE.md match the filesystem."
      exit 0
    else
      echo "DRIFT: counted facts in CLAUDE.md are stale. Diff (doc vs disk):"
      diff <(extract_block) <(gen_block) || true
      echo
      echo "Fix: bash scripts/facts.sh"
      exit 1
    fi
    ;;
  --write|"")
    # BSD awk cannot take a multi-line value via -v, so the new block goes
    # through a file and is spliced with getline.
    blockfile="$(mktemp)"; tmp="$(mktemp)"
    gen_block > "$blockfile"
    awk -v b="$BEGIN" -v e="$END" -v bf="$blockfile" '
      $0 == b { while ((getline line < bf) > 0) print line; close(bf); skip=1; next }
      $0 == e { skip=0; next }
      !skip   { print }
    ' "$CLAUDE_MD" > "$tmp"
    # Guard, learned the hard way: this script once emptied CLAUDE.md because
    # awk failed and `mv` ran anyway. The exact invariant is NOT "the file must
    # not shrink" (a smaller generated block is legitimate) — it is: everything
    # OUTSIDE the anchors must come out byte-identical. Anything else is a bug
    # in the splice, and the original stays untouched.
    outside() { awk -v b="$BEGIN" -v e="$END" '$0==b{skip=1} !skip{print} $0==e{skip=0}' "$1"; }
    if [[ ! -s "$tmp" ]] \
       || ! grep -qF "$BEGIN" "$tmp" || ! grep -qF "$END" "$tmp" \
       || ! diff -q <(outside "$CLAUDE_MD") <(outside "$tmp") >/dev/null; then
      echo "ERROR: splice would change CLAUDE.md outside the FACTS anchors — original left untouched." >&2
      diff <(outside "$CLAUDE_MD") <(outside "$tmp") | head -10 >&2 || true
      rm -f "$tmp" "$blockfile"
      exit 3
    fi
    mv "$tmp" "$CLAUDE_MD"; rm -f "$blockfile"
    echo "Wrote counted facts into CLAUDE.md:"
    gen_block | sed '1d;$d'
    ;;
  *) echo "usage: $0 [--write|--check|--print]" >&2; exit 2 ;;
esac
