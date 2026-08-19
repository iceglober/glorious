---
"@glrs-dev/glrs": minor
---

A config that does nothing now says why.

`{"model": {"selected": "azure/gpt-5.6-sol"}}` in a project file ran for a week
as the default model. The key was recognised and the value was the wrong type,
so it was dropped exactly as silently as a typo — and the comment above that
code said "a config that silently does nothing is the hardest kind to debug".

- **A recognised key holding the wrong type is reported.** `"model" should be a string like "azure/gpt-5.6-sol", got object — ignored`.
- **A file where nothing at all is recognised is reported**, naming the keys it found. That catches a config written for another agent, or for an older glorious with a nested `agent.llm` shape.
- **Diagnostics appear at startup**, not only under `glorious doctor`. Doctor is a command you run once you already suspect something, and a silent config gives you nothing to suspect.

Keys glorious does not know, in a file where it knew something, stay ignored and
silent. A config that has grown a key is not a broken config.

`.glorious/config.local.json` is read as the nearest layer — the conventional
name for the copy you do not commit, and the first thing anyone reaches for. It
was silently not a file glorious opened.

Print mode built its model with `currentModel()` and no arguments, so a model
set in `.glorious/config.json` worked in the TUI and was ignored by every
headless run — including the ones the agent uses to verify its own work.

`loadConfig` takes the home directory as a parameter, for the same reason
`loadSkills` does: the tests read whatever config was installed on the machine
running them, which is green on CI and red on a laptop that has one.
