---
"@glrs-dev/glrs": minor
---

Give a tool call three lines instead of one.

```
✓ bash  1.2s
    git status --short
    M v2/render.ts
    ?? notes.txt
```

The header carries only what is true at a glance — did it work, what was it, how long did it take — and the duration appears only once there is one, so a running call reads `→ bash` with its arguments and no number counting up in place. Underneath: the arguments, then the last three non-blank lines of the output, each clamped. A 30,000-character result contributes three lines, never thirty, and the tail is kept rather than the head because a command's last lines are the ones that say how it ended.

Output is shown for calls that succeeded, not only ones that failed. A `grep` that found three matches now says which, and a `bash` that printed something says what.

Print mode draws the same three parts, so a piped trail and a watched session describe a call the same way.

An extension's `renderCall` / `renderResult` replaces the body; the mark and the duration stay glorious's, so they mean the same thing on every row whoever wrote the tool.
