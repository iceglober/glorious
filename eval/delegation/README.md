> **Historical.** `run_subagent` was removed because of what this measured —
> see the commit that removed it. The scripts are kept as the record; the
> subagent arms build their own agent loop rather than calling a tool that
> no longer exists.

# Does the prompt get the agent to delegate?

The task is a survey whose contents are worthless once the answer is known —
the case `<delegation>` names, and the case the old worked examples
demonstrated doing by hand.

Both arms get the same tools and the same task. Only the system prompt differs.

- **before** — the prompt at `a75369e`: two long worked examples, neither
  delegating, and a `<grounding>` clause making a delegated finding
  inadmissible.
- **after** — four short scenarios, three of which delegate, and a `<grounding>`
  clause that admits what a subagent reports.

The fixture is 18 modules, ~7k tokens to read in full. Three re-schedule a job
after failure, each through a differently named local helper, so no single
search finds them — the answer requires reading.

```
SEEDS=5 bun eval/delegation/run.ts
```

## Result (n=5 per arm, gpt-5.6-luna)

| arm | delegated | avg calls | parallel | avg steps | avg input |
| --- | --- | --- | --- | --- | --- |
| before | **0/5** | 0.0 | 0 | 4.6 | 36,141 |
| after  | **4/5** | 0.8 | 0 | 5.0 | 36,628 |

The prompt change moved delegation from never to usually.

## What it does not show

- **No parallel delegation in either arm**, despite two of the four scenarios
  demonstrating it. The change moved single delegation and did nothing for
  parallel.
- **No token saving.** `run_subagent` is stubbed — it returns a plausible
  summary without doing the reading — so the saving the block argues for cannot
  appear here. Input is flat, and this measures the reach for the tool, not the
  payoff of using it.
- Whether the answers were right is not scored.
- One model, one task shape, five seeds.
