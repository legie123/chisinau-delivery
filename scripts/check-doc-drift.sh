#!/usr/bin/env bash
# BUCLA meta-verifier (Master Council recommendation): heuristic drift check
# between CLAUDE.md's documented state (FIXED / KNOWN ISSUE / pending) and what
# actually exists in supabase/migrations/. Doc/code drift already cost a real
# finding once — the GPS-private-channel fix (migration 20260717002100) was
# briefly at risk of being listed stale in CLAUDE.md after it shipped. This is
# a pragmatic bash+grep tool, NOT a real parser — it flags candidates for a
# human/reviewer, it does not silently auto-fix anything.
#
# Two drift classes:
#   1. STALE KNOWN-ISSUE — CLAUDE.md marks something unfixed/pending, but a
#      migration matching an id referenced on that same line already exists
#      in the tree (the doc fell behind a fix that shipped).
#   2. UNDOCUMENTED MIGRATION — a migration file exists with no mention of it
#      (by full 14-digit id, legacy 6-digit shorthand, or filename keywords)
#      anywhere in CLAUDE.md.
#
# Exit 0 = PASS (no drift found). Exit 1 = DRIFT (see report). Exit 2 = usage
# error (CLAUDE.md or migrations dir missing).
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLAUDE_MD="$ROOT/CLAUDE.md"
MIGRATIONS_DIR="$ROOT/supabase/migrations"

if [[ ! -f "$CLAUDE_MD" ]]; then
  echo "ERROR: $CLAUDE_MD not found" >&2
  exit 2
fi
if [[ ! -d "$MIGRATIONS_DIR" ]]; then
  echo "ERROR: $MIGRATIONS_DIR not found" >&2
  exit 2
fi

STALE_COUNT=0
UNDOC_COUNT=0
REVIEW_COUNT=0

echo "== doc-drift check =="
echo "doc:        $CLAUDE_MD"
echo "migrations: $MIGRATIONS_DIR ($(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | wc -l | tr -d ' ') files)"
echo

# ---------------------------------------------------------------------------
# 1. known-issue / pending markers in CLAUDE.md
# ---------------------------------------------------------------------------
echo "--- 1. known-issue / pending markers in CLAUDE.md ---"
MARKER_LINES="$(grep -inE 'KNOWN \(unfixed\)|nefixate|KNOWN ISSUE|\bunfixed\b|\bpending\b' "$CLAUDE_MD" || true)"

if [[ -z "$MARKER_LINES" ]]; then
  echo "(none found)"
else
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    lineno="${line%%:*}"
    text="${line#*:}"
    echo "L${lineno}: ${text# }"

    if echo "$text" | grep -qiE 'FIXED'; then
      echo "    -> also marked FIXED on this line; treated as informational (residual sub-task), not drift."
      continue
    fi

    # any full 14-digit migration id referenced on this line?
    ids_in_line="$(echo "$text" | grep -oE '2026[0-9]{10}' || true)"
    found=""
    for id in $ids_in_line; do
      if ls "$MIGRATIONS_DIR" | grep -q "^${id}_"; then
        found="$id"
        break
      fi
    done

    if [[ -n "$found" ]]; then
      echo "    -> DRIFT (stale doc): references migration ${found}, which already exists in the tree, but the line is not marked FIXED."
      STALE_COUNT=$((STALE_COUNT + 1))
    else
      echo "    -> no migration id on this line to auto-verify; flagged for manual review."
      REVIEW_COUNT=$((REVIEW_COUNT + 1))
    fi
  done <<< "$MARKER_LINES"
fi

echo
echo "--- 2. migrations with no mention in CLAUDE.md (undocumented) ---"
EARLIEST_DATE="$(ls "$MIGRATIONS_DIR" | grep -oE '^[0-9]{8}' | sort | head -1)"

for f in "$MIGRATIONS_DIR"/*.sql; do
  base="$(basename "$f" .sql)"
  full_id="${base%%_*}"                # 14-digit timestamp
  date_prefix="${full_id:0:8}"
  short_id="${full_id: -6}"             # legacy 6-digit shorthand (HHMMSS tail)
  desc="${base#*_}"                     # description part after the id
  words="$(echo "$desc" | tr '_' ' ')"  # space-separated words for phrase match
  phrase_pattern="$(echo "$words" | sed -E 's/ +/[ _-]+/g')"

  documented=0

  if grep -qF "$full_id" "$CLAUDE_MD"; then
    documented=1
  # legacy shorthand only trusted for the earliest migration batch — later
  # batches always reused the same 6-digit tails on other dates too (e.g.
  # 000200 is both 20260708000200 AND 20260726000200), so shorthand match on
  # a later date would be a coin-flip; only accept it where it's unambiguous.
  elif [[ "$date_prefix" == "$EARLIEST_DATE" ]] && grep -qE "migration[^0-9]{0,15}${short_id}" "$CLAUDE_MD"; then
    documented=1
  elif grep -qiE "$phrase_pattern" "$CLAUDE_MD"; then
    documented=1
  fi

  if [[ "$documented" -eq 0 ]]; then
    echo "UNDOCUMENTED: ${base}.sql"
    UNDOC_COUNT=$((UNDOC_COUNT + 1))
  fi
done

if [[ "$UNDOC_COUNT" -eq 0 ]]; then
  echo "(none — every migration has at least a heuristic mention)"
fi

echo
echo "== summary =="
echo "stale known-issue mentions (DRIFT): $STALE_COUNT"
echo "undocumented migrations (DRIFT):    $UNDOC_COUNT"
echo "flagged for manual review (info):   $REVIEW_COUNT"

if [[ "$STALE_COUNT" -eq 0 && "$UNDOC_COUNT" -eq 0 ]]; then
  echo
  echo "PASS: no doc/migration drift detected."
  exit 0
else
  echo
  echo "DRIFT: doc/migration mismatch found — see above."
  exit 1
fi
