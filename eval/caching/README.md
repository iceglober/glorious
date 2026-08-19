# Volatile content and the prompt cache

Does putting volatile content in the system prompt cost the cache?

Two shapes run the same two turns. Between them the environment changes — the
date, the branch, the dirty-file count — which is what happens whenever a
session is resumed. Turn 2 reports how much of its input the provider served
from cache.

- **A** — environment block at the tail of the system prompt, the way glrs
  used to assemble it.
- **B** — static system prompt, environment inside the user message and frozen
  into history. What it does now.

```
bun eval/caching/run.ts
```

## Result

| shape | turn 1 | turn 2, after the environment changed |
| --- | --- | --- |
| environment in system prompt | 0% | **0%** |
| environment in user message  | 0% | **98%** (3,092 / 3,153) |

Turn 1 is cold in both, as expected. In turn 2 the changed footer truncates the
cached prefix at the system prompt, so the entire conversation behind it is
reprocessed. Moving the same text into the user message leaves the prefix
intact.

The effect grows with the conversation: what is lost is everything after the
system prompt, so a long session loses more.

## Caveat

One provider, one model, small fixture, n=1 per cell. The effect is large
enough to read at n=1, but this measures a cache hit rate, not a cost saving —
cached input is discounted, not free.
