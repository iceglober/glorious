# glrs repository cutover

Move the launch snapshot from `iceglober/glorious` to the empty
`iceglober/glrs` repository and publish `@glrs-dev/glrs@1.0.0` as the first
stable release.

## before the cutover

- merge every intended pull request into `glorious/main`
- require green CI, release checks, and docs build on that commit
- close, but do not merge, any prerelease **Version Packages** pull request
- keep `iceglober/glrs` empty until its secrets and variables are configured
- do not delete `glorious` until the new repository, npm release, and docs deploy
  are verified

## prepare the launch snapshot

Create one root commit from the final `glorious/main` tree, with these launch-only
changes:

- set the root and package manifest versions to `1.0.0`
- remove `.changeset/pre.json` and all consumed prerelease changesets
- reset `CHANGELOG.md` to one `1.0.0` launch entry
- publish and install from npm's `latest` tag instead of `next`
- point package metadata, documentation, badges, and workflows at
  `iceglober/glrs`
- expose only the `glrs` executable name

Run the full typecheck, boundary/Biome check, test suite, docs build, and
`bun publish --dry-run --access public --tag latest`. Confirm the launch commit
has no parent and the destination repository is still empty.

## credentials and repository settings

Configure these before pushing `main`, because the first push starts release and
docs workflows immediately.

Secrets:

- `NPM_TOKEN`
- `RELEASE_PAT`
- `GCP_WIF_PROVIDER`

Variables:

- `GCP_DOCS_BUCKET=glrs-dev-docs`
- `GCP_PROJECT_ID=glorious-dev`
- `GCP_SERVICE_ACCOUNT=glrs-docs-deploy@glorious-dev.iam.gserviceaccount.com`
- `GCP_URL_MAP=glrs-docs-urlmap`

Update the GCP Workload Identity provider and service-account binding to accept
`iceglober/glrs`. During the transition, allow both repositories; remove the
`iceglober/glorious` condition and binding only after the new docs deployment
succeeds.

Set the new repository homepage to `https://glrs.dev`. Apply branch protections
or rulesets after the initial root commit exists.

## launch and verify

Push the prepared root commit as `iceglober/glrs`'s `main`, then verify:

1. GitHub Actions CI passes.
2. The release workflow publishes `@glrs-dev/glrs@1.0.0`.
3. npm's `latest` tag points to `1.0.0`; the historical prereleases remain under
   their immutable version numbers.
4. The docs workflow deploys successfully and `https://glrs.dev` serves the new
   repository links and stable install commands.
5. A clean machine can install, run `glrs --version`, and run `glrs doctor`.

Only then archive or delete `iceglober/glorious`, tighten GCP identity to the new
repository, and remove any obsolete prerelease branch or npm `next` tag.
