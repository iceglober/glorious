---
"@glrs-dev/glorious": minor
---

Tool rows read as the call that was made.

```
  ✓ bash(git status --short)
    ↳ M v2/render.ts
    ↳ M v2/index.ts
    completed in 1.2s
```

The name and its arguments sit together on the header the way they were
written, rather than the name alone with the arguments stranded on the line
below. Arguments fold onto a second line when a one-line budget is not enough —
a command with a path in it used to spend the whole line on the path — and the
fold prefers a space, because breaking a path mid-segment reads as two paths.

Output hangs off arrows, so the tail of a 30k result is three lines that are
visibly output rather than three lines that could be anything. The duration
closes the row instead of sitting in the header, where it competed with the
arguments for the part of the line the eye lands on first.

Print mode calls the same renderer now. It had a second copy of this layout
written out by hand, which is exactly how two views of one call drift apart.
