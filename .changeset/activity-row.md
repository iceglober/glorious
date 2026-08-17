---
"@glrs-dev/glorious": minor
---

Colour the queued count like the rows it counts, and let an extension own the activity row.

The `· 2 queued` in the busy row was accent, the same tone as the phase and the interrupt hint, so it read as part of the hint rather than as a tally of the warning-toned queued rows sitting directly above it. It is now the same warning tone, and on a terminal too narrow for everything the count is what goes — the queued rows already show it, while the live phase reading and the way to stop the turn do not appear anywhere else.

The row is also replaceable now. `g.activity(render)` is handed `{ busy, queued, phase, columns }` and returns `Line[]` to own the row, or `null` to leave glorious's own. First extension to return lines wins, so a project overrides a personal one the same way it overrides a command, and one that throws loses only its turn at that frame.

That was the last thing glorious drew that an extension could not touch. Every rendered surface — tool rows, the status line, the footer, and now the activity row — is either replaceable or contributed to.
