---
"@glrs-dev/glrs": minor
---

An extension can add subcommands to the `glrs` executable.

`g.cli("wt", { description, run })` makes `glrs wt …` work. Until now an extension could give the agent a tool and give you a slash command, but everything it offered lived inside a session — so a capability that is really a piece of tooling, like managing git worktrees, had to be a separate program with its own name on your PATH.

**A subcommand runs outside any session.** No model, no transcript, no screen, no credentials, nothing to wait for. `g.print` writes straight to stdout undecorated so the output pipes; `g.root`, `g.exec`, `g.settings` and `g.z` work as usual; `g.send`, `g.model`, `g.ui.capture` and the rest throw and say why rather than returning something plausible. That refusal is filled in one place, so adding a member to the API cannot quietly leave this path with a hole in it — the type demands it be answered, and "this needs a session" is a better answer than a lie.

Extensions are loaded to find out whether a word is a subcommand, so this is reached only after glrs's own words are ruled out: a bare `glrs`, `glrs -p …`, `glrs doctor`, `glrs update` and `glrs --version` never pay for it, and none of them can be taken by an extension. The first extension to claim a subcommand keeps it, the same rule tools follow, so `glrs wt` does not depend on load order.

`glrs <unknown>` now lists what extensions have added rather than only what is built in — the extensions that would have claimed the word have just been loaded and asked, so naming them costs nothing.
