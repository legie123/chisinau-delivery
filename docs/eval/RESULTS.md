# CLAUDE.md rewrite — measured, 2026-08-25

Question: does the smaller CLAUDE.md actually make an agent more accurate, or does it
just make the file shorter?

## Method

- Two question sets, 30 each, written by agents that were **forbidden from reading
  CLAUDE.md, AGENTS.md, docs/ or .bucla/** — derived from source, migrations, scripts and
  config only. Every ground truth is backed by a real command and its captured output
  (`claude-md-eval.json`, `claude-md-eval-set2.json`).
- Set 2 was authored **after** the rewrite was committed and was never seen while writing
  the doc. Set 1 was seen, so set 2 is the number that counts.
- Closed-book: each run gets the doc(s) and nothing else. No repo, no web.
- Every answer must carry a **verbatim quote** from the document it was given. Quotes are
  machine-checked as substrings — an answer from model memory cannot be smuggled in.
  Across 393 answers, exactly **1** quote failed verification.
- "The doc is silent" must be answered `UNKNOWN`; guessing from general Next.js/Supabase
  knowledge scores as WRONG.
- 3 independent runs per arm. Grading by a separate agent that could not see which arm
  produced an answer.

## Result — held-out set 2

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
