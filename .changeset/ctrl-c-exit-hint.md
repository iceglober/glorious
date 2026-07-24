---
"@glrs-dev/glorious": patch
---

The first Ctrl+C on an empty prompt now shows a "Ctrl+C again to exit" hint above the status bar (and still interrupts a running turn). A second Ctrl+C within a few seconds exits; otherwise the hint times out and any other keypress dismisses it — so an accidental Ctrl+C no longer risks a silent exit or leaves you guessing.
