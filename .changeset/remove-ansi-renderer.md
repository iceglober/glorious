---
"@glrs-dev/glorious": minor
---

Remove the ANSI live-region renderer. The full-screen OpenTUI surface is now the only chat renderer — the `tui.renderer` config option and the `GLORIOUS_TUI` env override are gone (a legacy `tui.renderer: ansi` in an existing config is ignored, not an error). This also fixes the "Ctrl+C again to exit" hint not appearing: it lived only in the ANSI screen, and is now implemented in the OpenTUI screen where the first Ctrl+C on an empty prompt shows the hint (and still interrupts a running turn), a second within a few seconds exits, and any other key dismisses it.
