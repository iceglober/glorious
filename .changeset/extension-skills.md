---
"@glrs-dev/glrs": minor
---

An extension can ship a skill, and a prompt contribution can say something about the session.

Two seams, both of which existed in a shape that was almost enough.

**`g.prompt` accepts a function.** It pushed a string, and the per-turn preamble was rebuilt every turn — but from strings fixed at registration, so a contribution could describe the extension and nothing else. Passing a function has it asked fresh each turn, which is what lets one say what the *session* is doing. Returning `""` says nothing, so a line that is only sometimes relevant costs nothing when it is not, and one that throws loses its own line rather than the turn. Both hosts resolve contributions through the same function; this is the third thing the TUI and `-p` each have to do identically and the previous two had drifted.

**An extension can carry a `skills/` directory** beside its source, laid out exactly like `.glrs/skills/`. The obstacle was ordering — skills are read at startup, extensions do not load until hundreds of lines later — and the fix is that `resolveExtensions` is inert: it stats directories and executes nothing, so it can run first and say which extensions *would* load. Their skill directories join the roots without a single extension having run, at startup rather than after a reload. Extension roots are appended last, so a skill in your project or your home directory still wins a contested name.

Two defects fixed on the way, both found while mapping this:

- **`~/.agents/skills` was searched twice.** It is listed explicitly and reached again by the ancestor walk whenever your project sits under `$HOME`, so every personal skill was found twice and warned that it collided with itself — naming the same path on both sides of the sentence. The test suite could not see it: every test passes a scratch home outside the tree, which is exactly what stops the ancestor walk reaching it.
- **`originOf` still tested for `/v2/bundled/`**, a directory that stopped existing when this became a monorepo. Nothing had matched it in months, so `/skills` and `/extensions` tagged everything glrs ships as `other`.
