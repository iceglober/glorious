# Does delegating pay?

`run.ts` stubs the subagent, so it can only measure whether the agent reaches
for the tool. This one is real: the subagent runs its own model loop with its
own file tools and its own context. All arms answer the same question over the
same 18-module fixture, and a win has to survive the *total* token count, not
just the parent's.

- **solo** — no `run_subagent`; the agent reads for itself.
- **delegate** — a generic subagent, the production instructions.
- **librarian** — Amp's specialised-search idea: read-only, told to report
  located facts rather than explain.

```
SEEDS=3 bun eval/delegation/pays.ts
```

## Result (n=3 per arm, gpt-5.6-luna)

| arm | correct | parent input | total input | wall |
| --- | --- | --- | --- | --- |
| solo | 3/3 | 35,808 | **35,808** | 12.1s |
| delegate | 3/3 | 21,230 | 64,877 | 31.7s |
| librarian | 3/3 | **17,379** | 65,194 | 30.9s |

**Delegation does not pay on this task.** Same answer every time, ~1.8× the
tokens and ~2.6× the wall clock. The subagent starts cold and re-reads what the
parent also read.

**Specialising helps the parent, not the bill.** The Librarian is the best arm
on parent context — 51% below solo — and indistinguishable from a generic
subagent on total cost and latency.

So the prompt's stated rationale is the correct one and the tempting one is
not: delegation buys headroom in the parent's context by spending more in
total. It is a trade against context exhaustion, not a saving.

## Caveats

- n=3, one model, one task shape. Totals ranged widely (librarian 44.6k–95.1k,
  delegate 56.3k–80.8k), so treat the two delegating arms as tied rather than
  separated by 300 tokens.
- Correctness never separated the arms — 3/3 everywhere — so this measures cost
  only. A harder fixture might.
- Each run delegated exactly once. Nothing here says anything about several
  subagents at once.
