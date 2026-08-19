---
name: shipping-engineering-work
description: Follow Glorious's branch, pull-request, CI, Changesets, and npm release workflow when shipping engineering changes.
---
# Shipping engineering work

Use this workflow for every code change in this repository. Do not improvise a
release path.

## Branch first

Start work from the current remote main branch, never from a stale local branch:

```sh
git fetch origin main
git switch -c <descriptive-branch> origin/main
```

Do not commit directly to `main`. Do not push directly to `main`. If work was
accidentally committed on `main`, preserve it on a feature branch before doing
anything else.

## Implement and verify

Keep the change focused. Before opening a pull request, run the same checks CI
runs on pull requests:

```sh
bun run typecheck
bun run check
bun run test
```

`bun run check` is the Biome check. If a local nested worktree prevents it from
running, report that exact blocker and run the narrowest equivalent check for
the touched files; do not change CI configuration to work around local state.

For TUI changes, also drive the real terminal UI and verify the requested
visible behavior. Static checks do not prove TUI behavior.

## Changesets

Add a changeset for user-facing or publishable package changes. Do not add one
for internal-only changes unless the requester asks for a release.

The package is `@glrs-dev/glorious`. The repository is currently configured for
Changesets prereleases under npm's `next` tag. A changeset belongs in
`.changeset/` and declares the intended semver bump.

Do not run either of these as part of normal feature delivery:

```sh
bun run version:packages
bun run release:next
bun publish
npm publish
```

## Pull request and merge

1. Commit the verified work on the feature branch.
2. Push that feature branch.
3. Open a pull request targeting `main`.
4. Confirm GitHub Actions CI passes: install, typecheck, Biome, and tests.
5. Merge the pull request into `main` only after checks pass and required review
   is complete.

Ask before actions that contact GitHub or alter remote history when the current
session has not already authorized them.

## Release automation

Merging a feature PR to `main` is the handoff point, not the npm publish step.

The `release.yml` workflow runs only on pushes to `main`. It runs the release
checks and Changesets action. When pending changesets exist, that action opens
or updates the **Version Packages** pull request. Merge that generated PR into
`main`; CI then publishes the resulting version to npm under `next` and keeps
the prerelease `latest` tag synchronized.

Do not manually publish to npm and do not create a version bump commit by hand.

## Final report

Report the branch, PR URL, checks run, whether a changeset was added, and the
release handoff state. Say explicitly when the next action is waiting on PR
review, CI, or the Version Packages PR.
