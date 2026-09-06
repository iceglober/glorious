---
"@glrs-dev/glrs": patch
---

Shape reasoning the way an answer is shaped, and tone it so the two cannot be confused.

`reasoningBlock` dropped every blank line and applied no markdown at all, so a thought arrived as one undifferentiated wall while the answer below it had headings, emphasis and code. The shaping is shared now:

- headings, bold, italic and code spans render, as they do in an answer
- paragraphs survive; a run of blank lines collapses to one, because reasoning arrives with far more whitespace than an answer does
- fenced code stays upright and verbatim, since italic code is harder to read than it is worth

What keeps it distinct is unchanged and now carries the whole job: every span is muted, prose is italic, the marker is `◐` against the answer's `●`, the body is indented, and it still closes with `thought for Ns`. The streaming draft gets the same treatment behind its `░`.
