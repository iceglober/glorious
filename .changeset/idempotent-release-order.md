---
"@glrs-dev/glorious": patch
---

The unconditional publish guard runs before the version bump, not after.

Placed after `changesets/action`, it read a `package.json` the action had
already bumped in the same workspace — so it published the *next* version, whose
PR nobody had merged. That released unmerged code and made version PRs
decoration.

It runs before the action now, where the workspace is still exactly main, so it
publishes only what main has committed.
