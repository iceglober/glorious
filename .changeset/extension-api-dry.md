---
"@glrs-dev/glrs": major
---

The extension API is declared once, so an extension author sees the same surface a maintainer does.

There were two descriptions of one thing: the object `extension-api.ts` builds, and a hand-maintained copy in `glrs-core` that every extension imported. They had drifted. The copy carried 26 members; the object carried 44. `model`, `tools`, `status`, `footer`, `key`, `flag`, `abort`, `activity`, `events`, `filterTools`, `idle`, `markdown`, `models`, `pending`, `setModel`, `setSessionName`, `shutdown` and `systemPrompt` all worked at runtime and were invisible to anyone writing an extension against the type.

The copy existed for a reason: `packages/extensions` may not import the coding agent, so the type could not live where it was implemented. So the declaration moved the other way — into `glrs-core`, where extensions already reach it — and the agent now *implements* that type rather than declaring its own. An implementation that falls behind can no longer compile.

`Tone` and `Span` had drifted the same way and travelled with it, along with the event payload types, so the whole contract is in one place.

**`UiHost` is gone.** A second, optional-everything description of the same surface, referenced by nothing. It declared `print`, `ask`, `status`, `footer` and `activity` — none of which any host implements, `ask` being residue of a removed widget — and omitted `setInput`, which all three do. Because every member was optional, `g.ui.status?.(…)` typechecked and was `undefined` at runtime.

**`/help` reads what was registered.** `KeySpec.description` and `FlagSpec.description` were required at registration and printed nowhere: help carried a hardcoded table, and a flag could not even be mentioned. `g.inspect()` now returns the bound keys and flags, and help renders them under glrs's own bindings.
