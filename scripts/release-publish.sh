#!/usr/bin/env bash
# Publish whatever version main is currently at, if npm does not already have it.
#
# Safe to run on every push, from anywhere in the workflow, any number of times:
# it reads the version from package.json and does nothing when the registry
# already has it. `bun publish` is not idempotent on its own — it 403s on a
# version that already exists and fails the run, which used to take the
# dist-tag sync down with it.
#
# This exists as a standalone step, not only as the changesets action's
# `publish` hook, because the action decides whether to publish at all: when it
# sees an unconsumed changeset it opens a version PR and publishes nothing. A
# version PR whose branch predates the newest changeset therefore merges, bumps
# main, and never publishes — main sat at 1.0.0-next.46 while npm served .45,
# three times in one day. Running the guard unconditionally makes the next push
# repair it, and makes every push converge on "npm has what main says".
set -euo pipefail

pkg="$(node -p 'require("./package.json").name')"
version="$(node -p 'require("./package.json").version')"

if npm view "$pkg@$version" version > /dev/null 2>&1; then
  echo "$pkg@$version is already on npm — nothing to publish"
  exit 0
fi

echo "publishing $pkg@$version"
bun publish --access public --tag next

# The registry's read path lags the write, so confirm rather than assume. A
# publish that reported success but is not readable is worth failing on: the
# dist-tag step after this one would otherwise point `latest` at a version
# nobody can install.
for _ in $(seq 1 30); do
  npm view "$pkg@$version" version > /dev/null 2>&1 && exit 0
  sleep 5
done

echo "published $pkg@$version but the registry still does not serve it" >&2
exit 1
