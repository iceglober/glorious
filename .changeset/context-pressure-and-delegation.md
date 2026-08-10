---
"@glrs-dev/glorious": patch
---

The agent can now see how much context it is holding, and its prompt is shorter.

- Each turn reports the conversation's size against a 200,000 token budget,
  overridable with `GLORIOUS_CONTEXT_BUDGET`. Measured on this model, the same
  task takes 3.7× longer at 163k of context than at 25k.
- The worked examples in the system prompt are a third of their former size and
  now show delegating rather than reading everything in the main thread. The
  whole prompt drops from about 2,650 to 1,950 tokens.
- `<grounding>` no longer treats a subagent's findings as unverified, which had
  required re-reading whatever was delegated and undone the point of delegating.
