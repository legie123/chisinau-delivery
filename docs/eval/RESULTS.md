# CLAUDE.md rewrite — measured, 2026-08-25

Question: does the smaller CLAUDE.md actually make an agent more accurate, or does it
just make the file shorter?

## ⚠ Independence of sets 1 and 2 is COMPROMISED — read this first

Both question authors were instructed not to read `CLAUDE.md` / `AGENTS.md` / `docs/`, and
neither called Read on them. **The harness auto-injected both files into their context
anyway**, as system-reminders — for set 1's author, including a live diff of the rewrite in
progress. Both authors disclosed this unprompted.

What survives and what does not:

- **Ground truth is sound.** Every answer was re-derived by the authors from source with a
  real command and captured output, and 8 of them were independently re-verified by hand
  against the repo. Several questions exist *because* the doc contradicted the filesystem.
- **Question selection is not blind.** Topic choice may be anchored on doc content, in
  either direction, and cannot be certified.

The A-vs-C comparison below is the least exposed to this: both arms had the **same facts**
available (the migration index is inline in A and in a pointed-to file for C), so the
measurement is about packaging, not about which facts a biased author happened to pick.
Set 3 (below) re-runs it from a source tree with no docs in it at all.

## Method

- Question sets of 30, written by agents working from source, migrations, scripts and
  config. Every ground truth is backed by a real command and its captured output
  (`claude-md-eval.json`, `claude-md-eval-set2.json`).
- Set 2 was authored **after** the rewrite was committed — but see the contamination note
  above.
- Closed-book: each run gets the doc(s) and nothing else. No repo, no web.
- Every answer must carry a **verbatim quote** from the document it was given. Quotes are
  machine-checked as substrings — an answer from model memory cannot be smuggled in.
  Across 393 answers, exactly **1** quote failed verification.
- "The doc is silent" must be answered `UNKNOWN`; guessing from general Next.js/Supabase
  knowledge scores as WRONG.
- 3 independent runs per arm. Grading by a separate agent that could not see which arm
  produced an answer.

## Result — set 3, clean room (this is the number that counts)

Set 3's questions were written by an agent working in `/tmp/cleanroom/repo`: a copy of the
source tree with **every document physically removed** (no CLAUDE.md, AGENTS.md, README or
docs/ anywhere in it). No doc could be auto-injected because none existed there. The author
confirmed no outside file entered its context.

| Arm | What it got | Score /30 | Wrong per run |
|---|---|---|---|
| A | old CLAUDE.md, 55,388 B, everything inline | 12.50 (41.7%) | 2.33 |
| C | new CLAUDE.md 12,718 B **+ the files it points at** | **18.00 (60.0%)** | **0.00** |

- **+44.0% relative accuracy, wrong answers 2.33 → 0.00 per run, 77.0% less context loaded
  up front.** 3 runs per arm, zero variance within each arm.
- A's wrong answers were dominated by the stale numbers this rewrite deleted: it claimed 67
  migration files (98 exist) and "34 RPC sims + 45 unit tests" (66 and 23 exist).
- 14 of C's answers came from `docs/migrations.md` / `docs/history.md` — the moved content
  still works, at the cost of 1-2 extra file reads.

### One eval error found and corrected

`s16` asserted that `dispatch_offers_order_courier_once` permanently forbids re-offering an
order to the same courier. It does not — `20260812000000_dispatch_cooldown.sql:19` drops
that index and replaces it with a 2-minute cooldown. The author's `verify_cmd` grepped only
the migration that *created* the index. Both arms had answered correctly and were penalised;
the table above is corrected. As graded, before the correction, it was 11.50 vs 17.00
(+47.8%, wrong 3.33 → 1.00).

**Known weakness:** 16 of set 3's 30 ground truths were verified by grepping a single
migration file, which is what produced that error. The other 15 were re-checked against
later migrations for contradictions and none was found, but the set is not certified beyond
that spot-check.

## Result — held-out set 2 (independence compromised, see warning above)

| Arm | What it got | Score /30 | Wrong answers per run |
|---|---|---|---|
| A | old CLAUDE.md, 55,388 B, everything inline | 9.00 (30.0%) | 0.00 |
| B | new CLAUDE.md alone, 12,718 B, pointers not followed | 7.00 (23.3%) | 1.00 |
| C | new CLAUDE.md **+ the files it points at** | **11.00 (36.7%)** | 0.00 |

- **C vs A: +22.2% relative accuracy, with 77.0% less context loaded up front.**
- B < A is the honest cost of the split: a doc that only points is worse than a doc that
  contains, if nobody follows the pointer. 14 of C's answers came from `docs/migrations.md`
  — the moved content still does work, at the price of one extra file read.
- Both sets are dominated by UNKNOWN (19-22 of 30 for every arm). Neither doc covers deep
  implementation detail, and neither pretended to: hallucination stayed near zero on both.

## What the test caught that review did not

Set 1 scored the first rewrite **below** the original (69.4% vs 72.8%). Three defects, all
introduced by the rewrite's wording, all fixed in commit `e6de391`:

1. Only the courier cash-float cap was documented, so all three runs **denied that the
   1400 MDL COD checkout cap exists**.
2. "append-only, no delete policy" on `delivery-proof` led a run to conclude photos are
   kept forever; they are purged at 90 days.
3. The generated line "RPC sims: 66 files" made two runs conclude 66 files = 66 sims.

Set 2 then caught a fourth: the Commands block still described `npm run verify` as three
steps after it had been changed to four.

## Honest limits

- 3 runs per arm is small. Per-run variance was zero on set 2 and ±0.5 on set 1, so the
  ranking is stable, but these are not confidence intervals.
- Set 1 numbers are pre-fix and were not re-measured after the fixes.
- Size is measured in **bytes**, not tokens — no tokenizer is installed on this machine and
  none was installed to produce a number.
- Arm C's advantage costs 1-2 extra file reads on questions needing per-migration detail.
