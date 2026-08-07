# Multi-file edit variant — A/B

Follow-up to the 2026 study in `core/lib/tools/edit/benchmarks/` (recoverable at
`f798763`), which compared `exact` / `batch` / `hash` and settled on `batch`.
That study batched edits **within one file**. This one asks whether batching
**across files** is better again, and whether the answer depends on the case.

## Design

Both fixtures carry exactly four bugs. The only variable is how they are spread:

- `fixtures/one-file` — four bugs in one module.
- `fixtures/spread` — four bugs, one in each of four modules.

Variants in `variants.ts`:

- `batch` — byte-identical rules to `v2/tools.ts`: one file per call, edits
  applied in order, all resolved before anything is written.
- `multi` — one call carries `files[]`, each with its own edits; every edit in
  every file is resolved before any file is written.

The agent gets `read` and the edit tool only — no bash, no grep — so the edit
strategy is the only thing that varies. Grading runs the fixture's `check.py`.

    SEEDS=4 bun eval/edit/run.ts

## Result (n=4 per cell, gpt-5.6-luna)

| case     | variant | pass | edit calls | steps | input tokens |
| -------- | ------- | ---- | ---------- | ----- | ------------ |
| one-file | batch   | 4/4  | 1.0        | 4.0   | 2,761        |
| one-file | multi   | 4/4  | 1.0        | 4.0   | 2,895        |
| spread   | batch   | 4/4  | 4.0        | 7.0   | 6,266        |
| spread   | multi   | 4/4  | 1.0        | 4.0   | 3,072        |

Within one file the two are the same tool and behave identically. Across files
`multi` uses **half the input tokens** and three fewer steps, and the effect is
structural rather than noisy: `batch` was 4 calls / 7 steps in every single
spread run, `multi` 1 call / 4 steps in every one.

The one-file gap of 134 tokens is inside the run-to-run spread (2,640–2,843 vs
2,750–3,086) and should not be read as a cost.

## What this does not show

- Accuracy is untested. All 16 runs passed, so these fixtures do not
  discriminate on correctness — the same blind spot the original study had,
  where all three variants scored 6/6.
- One model, tiny fixtures, four seeds.
- `batch` serialised its four calls across seven steps rather than issuing them
  together in one. A model that parallelised them would close most of the step
  gap, though not the token gap.
- The `multi` description ends with "prefer one call covering all the files you
  need to touch", which `batch` cannot say. Some of the effect is that nudge
  rather than the schema.
