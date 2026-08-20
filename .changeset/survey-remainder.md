---
"@glrs-dev/glrs": minor
---

The rest of the code that was not on a live path is either wired up or gone.

**Three were wired up, because each was a missing connection rather than a mistake.**

`forgetListings` emptied the `@`-completion file cache and nothing could call it — the cache had no invalidation hook anywhere. `/reload` is the user saying the tree changed, so it drops the listing there.

Machine-wide rules were read from four of amp's locations and none of glrs's own, so an administrator could install rules for amp on a machine and had no way to install them for glrs. `/etc/glrs/AGENTS.md`, the platform equivalents, and `~/.config/glrs/AGENTS.md` are read now, after amp's and therefore nearer.

`QueueMode`, `QUEUE_MODES` and `isQueueMode` were declared twice — once in the coding agent and once privately in provider-registry, which validates the setting. Neither package may import the other, which is the same reason the extension API had a duplicate, and the same fix: one declaration in `glrs-core`.

**The rest were removed**: `repoName`, which both call sites re-derived inline; the `task` key in `firstDetail`, matching no registered tool since a delegation tool was taken out; the `amazon-bedrock` and `google-vertex` entries of the provider factory map, which `createModel` returns before ever consulting; a `?? ""` and a `?? "load"` that no input could reach; three fields destructured from `probe()` and never read; and `packages/glrs-coding-agent/bin/glorious`, whose manifest entry went with the packaging fixes and which the published `files` never shipped.

**Five items stopped being dead without being touched.** Exporting the SDK made `createAgentCore`, `jsonSessionRepository`, `createProviderRegistry`, `Extension` and `glrs-core`'s own module body reachable, since `sdk.ts` value-exports them and is now the package entry. `ModelOption.apiKey` is in the same position: no config file sets it — credentials stay environment-only, deliberately, because a config file is a thing people commit — but a caller building an option through the SDK can, and that caller exists now.
