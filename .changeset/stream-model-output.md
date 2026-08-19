---
"@glrs-dev/glrs": minor
---

Stream the model's answer instead of waiting for it, and show reasoning while it happens.

- **Text appears as it is generated.** Model calls used `generateText`, so a turn was prompt up, a long silence, then the whole reply at once. On a measured prose turn the first text now lands 2.3s in and the turn finishes at 5.5s — 3.3 seconds of a 5.5 second turn that previously showed nothing but the progress animation.
- **Reasoning is visible.** On turns that reason — plan mode asks for high effort — the thinking streams in muted text, then collapses to a single `thought for 2s` line once the answer begins. The full text is kept in the session so a resumed session replays the same line.
- Usage, cost, context accounting and prompt caching are unchanged: they ride the same per-call hook as before, and caching is request-shaped. Subagents still use `generateText`, since their output is a returned summary rather than something painted live.
- Interrupting mid-answer keeps what was already written on screen, with `(interrupted)` beneath it.
