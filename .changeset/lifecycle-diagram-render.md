---
"@glrs-dev/glorious": patch
---

The lifecycle diagram showed literal asterisks.

Mermaid does not render markdown inside sequence-diagram labels, so the `**` used
to mark hooks that can change what happens next appeared as asterisks rather than
bold. A `◆` marks them now, with the legend saying so.
