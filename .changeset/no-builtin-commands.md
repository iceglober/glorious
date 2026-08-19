---
"@glrs-dev/glrs": minor
---

The core registers no slash commands and no tools of its own.

`/help`, `/clear`, `/skills` and `/extensions` were built in, and two of them could not have been written as extensions even in principle: the API exposed neither the skills catalogue nor the extension registry. A core that keeps capabilities its own extension API cannot reach is not extensible, it is just small.

All of them — plus a new `/reload` — now ship as `bundled/builtins.ts`, written against exactly the API a third party gets. With `web-fetch` already bundled, glorious ships nothing the core privileges: shadow any of them by name from `.glorious/extensions/`, or delete them and write your own. Nothing in the core depends on them existing.

The API gains what they needed: `g.inspect()` returns `{ commands, skills, extensions }` — every listing is a view over it — `g.clear()` drops the conversation the model replays, `g.reload()` re-reads from disk, and `g.print()` now takes `Line[]` as well as a string so an extension can draw styled output into the transcript.

They print into the transcript instead of opening a panel over it. A listing you can scroll back to, copy out of, and read beside the work that prompted it beats one that takes the screen and has to be dismissed — and it costs the API no windowing surface to support. `ui/overlays.ts` and the sheet-sizing machinery behind it are gone with them: 261 lines of UI and 90 of tests for geometry nothing draws any more.

Name collisions no longer have a privileged side. First registration wins, extensions register before skills and command files, and a duplicate never reaches the help listing or the autocomplete.
