---
"@glrs-dev/glrs": patch
---

Bring the shipped docs level with the API.

`docs/` is what the agent reads to extend itself, so anything missing from it is invisible to the agent no matter how well it works. Three parts of the API had shipped undocumented: `g.root`, and `g.ui.select` / `g.ui.confirm` / `g.ui.setInput` — the last of which is how an extension asks a question at all.

Also corrected drift: `tools.md` said permissions did not exist, which stopped being true when `tool_call` gained the ability to block a call; `architecture.md`'s module map still listed a deleted file and none of the extension modules; `models.md` said there was no model picker without mentioning that `g.models()` and `g.setModel()` make one writable. `models.md` now also says what happens when a connection drops mid-turn and how to resume.

Added a caution the docs earned the hard way: a gate that refuses a tool when `g.hasUI` is false makes `glorious -p` unusable — including the run an agent uses to verify its own work, which then retries until something times out.

Checked by extracting every method, event and `ui` member from the types and asserting each appears in `docs/`, rather than by reading.
