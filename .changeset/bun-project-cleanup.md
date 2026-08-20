---
"@glrs-dev/glrs": minor
---

The published package has an entry point, and the manifests stop claiming things that were not true.

**`sdk.ts` can be imported.** It declares `createCodingAgent`, `createAgentCore`, `jsonSessionRepository` and `createProviderRegistry`, TypeDoc generates the docs site from it, and it shipped inside every tarball — but the published package declared no `main`, `module` or `exports`, and the manifest naming it as an entry is `private: true`. Nothing could resolve it. The root package now exports it, and `./extension-api` alongside it.

**Claims removed rather than repaired**, because each was for machinery that does not run:

- `packages/glrs-coding-agent/package.json` declared `bin.glrs` pointing at `bin/glrs` — a path that does not exist in that directory. The shim is at the repo root.
- Its `prepack` ran `sync-docs.ts` on a package that is never packed; the release publishes the root package, which has no `prepack`, and root `files` excludes `scripts/`. Both are gone, and `docsPath()` loses the branch that script existed to fill — it could not be satisfied, so the fallback was always the live path.
- Its `exports` and `files` cannot be resolved by anything: there are no workspaces, so no package name resolves within the repo.

**`bun.lock` called the project `agentj`**, three renames ago. `bun install --frozen-lockfile` was verified to still work afterwards.

**CI typechecks `scripts/` and `eval/` now.** Both were outside `include` and both are clean. `docs/**/*.ts` came out because it matches nothing. Eval fixtures are excluded — they are deliberately broken, being the input an eval runs against.

**The docs dev server watches source again.** It had watched `packages/glorious-core` and `packages/glorious-coding-agent` since the rename, and a `.filter(existsSync)` swallowed both, so it had quietly stopped rebuilding on source changes.
