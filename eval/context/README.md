# Does a long context make the model worse?

Everything in `eval/delegation` rests on "longer is worse", which had been
assumed and never measured. Task, tools and fixture are fixed; only the amount
of prior conversation changes — plausible earlier turns about other modules of
the same codebase, carrying nothing the task needs.

Padding is built as nested prefixes, so the provider's cache is reused across
sizes and seeds.

```
SIZES=4000,25000,60000,120000,200000 SEEDS=3 bun eval/context/run.ts
```

## Result (n=3 per size, gpt-5.6-luna)

| context | correct | avg found | terse | steps | wall |
| --- | --- | --- | --- | --- | --- |
| 5,186 | 3/3 | 3.0 | 3/3 | 4.3 | 15.2s |
| 22,317 | 3/3 | 3.0 | 3/3 | 3.3 | 13.2s |
| 50,560 | 3/3 | 3.0 | 3/3 | 4.3 | 24.6s |
| 98,249 | 3/3 | 3.0 | 3/3 | 4.0 | 31.6s |
| 162,606 | **2/3** | 2.7 | 3/3 | 4.0 | **49.4s** |

**Latency is the clear finding.** Wall time rises monotonically from 25k
upwards and reaches 3.7× by 163k, on identical work. Steps stay flat, so this
is time per model call, not more work being done.

**Accuracy is not established.** It is flat to 98k, and one run of three missed
one of three answers at 163k. That is a single observation and should not be
read as a cliff.

**Instruction-following held everywhere.** The task asks for a bare list; every
run at every size complied.

## Caveats

- n=3, one task, one model. The task saturates at 3/3 below 163k, so it cannot
  resolve small accuracy differences — a harder fixture is needed for that.
- The window was never reached; 163k ran without error.
- Padding is synthetic and uniform. Real sessions accumulate heterogeneous
  material — long tool dumps, diffs, errors — which may behave differently.

## What this supports

A context budget is worth keeping, but the argument to make for it here is
latency, which is measured, rather than accuracy, which is one ambiguous point.
Settling accuracy needs more seeds above 150k and a task that does not saturate.
