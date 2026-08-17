---
"@glrs-dev/glorious": minor
---

Make the extension API deep enough to rebuild anything the core removed.

The API could register tools, commands, hooks and UI, but not reach the things that decide what a session *is* — so plan mode, the model picker and keybindings were gone rather than relocated. Now they are writable.

**Tool gating.** `tool_call` fires before a tool runs; returning a string or `false` blocks it and hands the model your reason by name, so it chooses something else instead of seeing an unexplained failure. `tool_end` can rewrite what the model is told came back. Both wrap every tool — built-in, bundled and third-party — because all of them go through the same wrapper. A read-only mode is now eight lines in a file, and the core knows nothing about it.

**Tools and models.** `g.tools()`, `g.setTools(names | null)` — withholding, not forbidding, so there is nothing to argue with. `g.model()`, `g.models()`, `g.setModel(label, variant)`: the picker is rebuildable.

**Keys and CLI flags.** `g.key({ key, ctrl, run })` runs before the composer sees the key. `g.flag(name, spec)` claims `glorious --name value`; because extensions load long after argv is parsed, unclaimed flags are carried and dispatched once their owner exists, and one nothing claims is reported rather than ignored.

**Turn and session control.** `idle()`, `pending()`, `abort()`, `usage()`, `systemPrompt()`, `shutdown()`, `session()`, `setSessionName()`, `appendEntry()` (persisted, never sent to the model), `markdown()` (display-only transform), and an `events` bus for extensions to talk to each other.

**More events**: `session_end` (awaited, so a flush on the way out completes), `user_bash`, `before_request` (a string is appended to that turn's message), `message` (streaming deltas), `idle`, `model_select`.

**Run mode.** `g.mode` is `"tui"` or `"print"` and `g.hasUI` is false headlessly. Anything needing a person throws in print mode rather than hanging, so an extension that guards on `hasUI` works in both.

Fixes a bug this surfaced: the session picker opened for *any* argument, because resuming keyed on `args.length === 0` rather than on `--resume` being present. `glorious --anything` now starts a session.
