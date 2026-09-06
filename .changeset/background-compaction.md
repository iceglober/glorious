---
"@glrs-dev/glrs": minor
---

Compact in the background, plan against a 256k window, brief with a cheaper model, and keep what was replaced.

**In the background.** The brief is written from a snapshot while a turn runs, and the check runs on every step rather than only at idle: an agentic turn is where the context grows, and idle was too late to look. A turn only appends, so the brief lands once the turn does. Started at idle, it holds the queue: anything typed meanwhile waits and then runs on the compacted history, since a turn that started anyway would pay exactly what the compaction was saving. Started mid-turn, it holds nothing. Compaction has its own abort handle now; it used to share the turn's, which could not have worked once the two overlap. Esc stops the turn and leaves a background brief to finish, or abandons an idle one and holds the queue, as Esc does whenever messages are waiting.

**Against a 256k window.** `compactWindow` caps what compaction plans against, 256,000 by default. A million-token model is compacted as if it had 256k, because every turn past there re-sends all of it at full price. A model whose window the catalogue does not know is assumed to have 256k rather than never being compacted, which was the case for every OpenAI-compatible endpoint.

**With a cheaper model.** `compactModel` names who writes the brief. Summarising suits something faster and cheaper than the model doing the work, provided its window is at least `compactWindow`.

**Keeping what it replaced.** The brief is lossy by design; the messages it stood in for are written beside the session unchanged, one file per compaction, labelled with the brief's first line. The new `compaction-artifacts` extension gives the agent `compaction_list`, `compaction_read`, `compaction_annotate` and `compaction_delete`, and tells it they exist only once one does. `/artifacts` lists them for you. Disable the extension and the files still land.
