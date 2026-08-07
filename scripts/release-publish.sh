#!/usr/bin/env bash
# Idempotent publish for the changesets action's `publish` step.
#
# When there are no changesets, changesets/action still runs `publish` to catch
# unpublished versions. `bun publish` isn't idempotent — it 403s on a version
# that's already on npm and fails the run (which also skips the latest-dist-tag
# sync step). Skip when the current version is already published; publish
# otherwise. In pre-release mode we publish under the `next` tag.
set -euo pipefail

pkg="$(node -p 'require("./package.json").name')"
version="$(node -p 'require("./package.json").version')"

if npm view "$pkg@$version" version > /dev/null 2>&1; then
  echo "$pkg@$version already on npm — nothing to publish"
else
  bun publish --access public --tag next
fi
