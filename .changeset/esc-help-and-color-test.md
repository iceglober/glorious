---
"@glrs-dev/glorious": patch
---

`/help` now describes what Esc actually does: it interrupts the turn, and only takes back the newest queued message when nothing is running. The line read "interrupt the turn · drop the newest queued message" as if it did both — which is exactly the behaviour that was fixed when it stopped silently dequeueing mid-turn.

Also makes a test immune to the environment it runs in. It spawns a child and parses its stdout as a number; with `FORCE_COLOR` set in the parent — which a terminal or a CI wrapper may well do — Bun wraps even a bare number in colour codes, so the parse yields `NaN`. It failed locally and passed in CI, which is the worst way for a test to be wrong: it teaches you to ignore a red suite.
