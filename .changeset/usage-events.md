---
"@glrs-dev/glrs": minor
---

Expose everything the core already knew about tokens, cache and cost.

Three things had drifted apart: what glorious computes per model call, what it writes to the session, and what an extension can see. Usage was computed in full — input, output, cached, cost — persisted in full, and exposed as `{ tokens }`. There was no usage event at all, so a cost tracker or cache-hit monitor could not be written.

Now `usage` fires once per model call with `{ input, output, cached, cost, contextTokens }`, and `g.usage()` returns the live context size, the model's window, the last call, and a session total including `steps`. The total is summed from the session's own events, so a resumed session reports what the whole session cost, and `/clear` does not reset it — clearing drops what the model replays, not what the run spent.

The same drift elsewhere, closed: `tool_end` now carries `detail` and `elapsedMs`; `reasoning` (with how long the model thought) and `error` are observable rather than only recorded.

A tool call is now timed once, where it runs, and the measurement travels on the event. `chat.ts` used to pair start with end and subtract, so the transcript and anything else reading the same call could disagree about its duration.

Print mode reached parity: it never hydrated model pricing, so every headless cost was zero — in the one mode you would script a cost report from — and it never fired `idle`, so an extension reporting totals on settle worked interactively and did nothing under `-p`.

A test now reads the source and asserts every field on a session event appears in the matching payload, so these cannot drift apart again.
