---
"@glrs-dev/glrs": patch
---

Rename the `provider-registry` package to `glrs-providers`.

Internal only: no published entry point moves, and the package is bundled rather than published. The three packages now read `glrs-core`, `glrs-providers`, `glrs-coding-agent` instead of two prefixed names and one that was not.
