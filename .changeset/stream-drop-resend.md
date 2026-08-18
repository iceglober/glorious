---
"@glrs-dev/glorious": minor
---

A dropped stream is re-sent instead of killing the turn.

`the connection to the model dropped mid-response` ended the turn and discarded
everything in it — in one observed case, eleven completed tool calls. The retry
that already existed could not help: `fetchWithDeadline` retries while the
request is being *made*, and a mid-response drop happens long after `fetch()`
resolved, while the body is being read. Nothing was watching that.

The stream is now re-sent, up to three attempts with a widening pause, **exactly
while the attempt is unobservable** — no text written, nothing thought aloud, no
tool run. Then re-sending is invisible and safe. Once anything has been
produced, a re-send would duplicate it or run a tool twice, so the failure
surfaces as before and the reminder tells the model it was interrupted.

The decision is one predicate, `shouldResend`, tested for each way it can go:
nothing produced, something produced, Esc pressed, attempts exhausted, and a
failure that is a refusal rather than a drop. A retry announces itself in both
the TUI and `-p` rather than looking like a stall.
