---
"@glrs-dev/glorious": minor
---

Multi-file editing, safer subagents, and a documented set of decisions.

- `edit` now changes any number of files in one call. Every replacement in every
  file is resolved before anything is written, so a failure leaves the whole tree
  untouched, and each file is swapped into place by rename rather than rewritten.
  Measured against per-file batching, work spanning four files uses 51% fewer
  input tokens.
- Subagents are safe to run in parallel. Tool events from concurrent subagents no
  longer collide, so durations in the transcript are correct; a subagent can no
  longer reach the user, and one that runs out of steps says so instead of
  returning nothing.
- A failed edit now reports how many times the text occurred, and says when a
  miss was against text an earlier edit in the same call produced.
- README and glrs.dev rewritten against the code. The site had documented an
  `edit` strategy setting and a context limit that do not exist.
