---
"@glrs-dev/glrs": minor
---

Config decides which extensions load, and the ones that add a capability now wait to be asked for.

Turning off a bundled extension meant shadowing it with a file of your own that did nothing — and an npm-installed glrs has no file to delete, so `web_fetch` was a tool you could not decline. `extensions.disable` names one and it does not load, from any of the four config files.

**`web-fetch` and `ask-user` no longer load by default.** They ship in the box and wait for `{"extensions":{"load":["web-fetch"]}}`. `builtins` is the exception and loads unless you explicitly disable it, because it carries the six tools and every slash command and an agent without them cannot do anything. This is a visible change on upgrade: `web_fetch` and `ask_user` disappear from an existing install until named.

`load` takes a shipped extension's name, the package it ships as, or a path — relative to the config file that wrote it, or absolute. Naming it by package specifier works today against the bundled copy and keeps working the day these are installed rather than shipped, so a config written now survives that change. `tools.disable` is a sibling key that withholds a tool name from the model whichever extension registered it, riding the same filter seam `g.filterTools` uses so the two intersect rather than one overwriting the other.

Unlike every other setting, these lists **add up across all four config files** rather than the nearest one winning. They are sets, not values: a project activating one extension must not switch off the one your personal config activates everywhere. `disable` beats `load` from any layer, because turning something off is the direction that has to be safe.

A name in `load` that resolves to nothing is a failure and says so under the spelling you wrote. A name in `disable` that matches nothing is only a note — nothing is broken, and the usual cause is `web_fetch` typed for `web-fetch`.

`glrs doctor` now lists what would load and where each one came from, resolved without running any of it. An extension is a program, and a diagnostic that executes programs is not a diagnostic. `/reload` re-reads config too, so editing `extensions.load` and reloading means the same thing as restarting — which is the one job anybody would use it for.
