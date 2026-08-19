---
"@glrs-dev/glrs": minor
---

`/reload` reloads extensions, and `write` can reach the directory the docs point at.

Two defects from one live session, where glorious was asked to give itself a new
capability and then could not use it.

**`/reload` did not reload extensions.** It re-read skills, commands and
sequences, reported `(reloaded — 28 skills, 37 commands, 0 sequences)`, and said
nothing about the one thing it had skipped. Installing an extension — which is
what glorious does when it extends itself for you — required a restart to see.
It now resets the registry and re-imports every extension with a cache-busting
token, so an edited extension is re-read rather than served from the module
cache. Load failures are reported the same way they are at startup, and the
message counts extensions.

**`write` refused `~/.config/agents/extensions/`.** The docs tell the model to
put a personal extension exactly there; `write` and `read` refused the path for
being outside the project, so the model installed it with a `python3` heredoc
through `bash` — which is unconfined, so the guard bought nothing and cost a ✗
row and a clumsier path. `read` and `write` now reach glorious's own directories
(`~/.config/agents`, `~/.agents`, `~/.glorious`, `~/.config/glorious`) and
nothing else under home. This is the same lesson as the earlier fix for the docs
directory, learned a second time.
