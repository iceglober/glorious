---
"@glrs-dev/glorious": minor
---

A tool call is one line.

```
  ✓ read    v2/render.ts · 432 lines                            8ms
  ✓ grep    "toolRow" in v2/ · 2 matches                      124ms
  ✗ edit    v2/render.ts                                       24ms
    old_string not found in file
  ✓ bash    bun test --timeout 60000 · 308 pass               23.8s
  └ 4 calls · 24.0s · 1 failed
```

It was five lines per call, so a turn doing twelve things cost sixty lines of
scrollback to carry maybe three facts worth having.

What comes back is a summary rather than a tail — `432 lines`, not the last
three lines of the file. Tools describe their own results, and an extension's
tool describes itself through `renderResult`, whose first line is what lands in
the row. One seam, not two, so nothing can drift.

Only a failure earns a second line, carrying the reason. It is the one piece of
output nobody should have to go looking for.

The footer closes a run of calls — everything between two things the model said
— and is the receipt no individual row can give. A single call gets none,
because the row above already says it.

The tool name has a fixed column, so calls align without any row knowing about
the others. Nothing is buffered or redrawn to achieve it: each row still prints
as its call lands, and the footer is one more line after the last of them. Live
rendering, session replay and print mode fold events through the same rule.
