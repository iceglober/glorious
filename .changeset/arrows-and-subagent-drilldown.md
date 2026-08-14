---
"@glrs-dev/glorious": minor
---

Arrow keys edit the draft, and a subagent's tool calls stay out of the session.

- **↑/↓ move within what you are typing** and only reach for history at the first and last line, the way a shell does. `Ctrl+P`/`Ctrl+N` remain unconditional history, so recalling a long prompt never costs you fast cycling. Lines are logical, so a soft-wrapped paragraph counts as one.
- **A subagent's tool calls no longer stream into the transcript.** Each carries the id of the `run_subagent` row that spawned it, so the session shows one summary row per subagent — its task, tool count and elapsed time — instead of two agents' work interleaved.
- **`Ctrl+B` opens a running subagent's stream** in the composer, with `Tab` to cycle when several are live and `Esc` to close. Subagents stay reachable for the rest of the turn after they finish. With none running the key does nothing and the hint stays hidden.
