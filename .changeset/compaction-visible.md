---
"@glrs-dev/glorious": minor
---

`/compact` says what it is doing while it does it, and shows what it kept.

Summarising a long conversation is a model call that can run for minutes. It ran
with nothing on screen — the composer emptied, no row appeared, and a command
that was working read as one that had died. It now rides the same phase signal a
turn does, so the status row counts it out (`compacting 42.1s · Esc interrupt`),
and the same abort controller, so Esc stops it and leaves the conversation
exactly as it was.

When it finishes, the brief is printed. It was already announced as an event and
then rendered as nothing, so a compaction was a line saying some number of
messages went away with no way to see what survived them.

Slash commands echo what was typed, the way `!` and `$` already do. Without it
the composer emptied and, for anything slower than instant, nothing took its
place.

Compaction also reported itself twice, in two different formats with two
different numbers. One line now, from the place the compaction happens, so an
automatic one reads exactly like an asked-for one.

Tool row output lines are indented a step further than the call and the
duration, which frame them.
