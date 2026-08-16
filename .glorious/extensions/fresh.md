---
description: Start new work on a fresh branch off origin/main
run: |
  set -euo pipefail
  test -n "${1:-}" || { echo 'usage: $fresh <branch-name>' >&2; exit 2; }
  test -z "$(git status --porcelain)" || {
    echo 'working tree is dirty — commit or stash before starting new work' >&2
    exit 1
  }
  git fetch origin main
  git switch -c "$1" origin/main
clear: true
---

Starting fresh on a new branch cut from `origin/main`, per
`.glorious/skills/shipping-engineering-work/SKILL.md`.

Nothing you learned about the previous branch still applies. Read before acting.
