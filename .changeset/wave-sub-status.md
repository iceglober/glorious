---
"@glrs-dev/glrs": minor
---

Say what the model is doing while you wait for it.

The wave now carries a phase and how long it has been in it — `waiting 2.3s`, `thinking 11.9s`, `writing 0.4s` — driven by the model call itself rather than a timer. Tool activity is left to the rows above it, which already name the tool and its elapsed time.

This closes the gap streaming did not. Streaming works, but a median assistant message here is 205 characters, which arrives in under half a second; the wait *before* any text appears was measured at 2.3 seconds, and a high-effort turn can reason for twelve. That stretch used to be an animated line with no information in it.

Also fixes a long-standing overrun: on a narrow terminal the interrupt hint was clipped to the full width and then given a two-space separator, making the row two columns wider than the screen.
