---
"@glrs-dev/glrs": minor
---

`glrs wt` creates and audits git worktrees, and knows which ones you are still working in.

Worktree management arrives as a first-party extension: `glrs wt` from a terminal, `/wt` inside a session, and a skill that teaches the agent when to reach for one. It ships off, like every first-party extension since — `{"extensions":{"load":["worktree"]}}` turns it on.

**`glrs wt doctor` is why this is an extension rather than a wrapper.** glrs records the directory every session ran in, so it can tell you which worktrees somebody is still working in before you clean anything up — something a standalone tool cannot know:

```
fix-the-login-redirect
    /Users/…/.glrs/worktrees/repo/fix-the-login-redirect
    active 9m ago · a session was working here recently · 2 uncommitted changes
```

A session older than a week is reported but does not block: that is history, not occupancy.

`wt new "fix the login bug"` makes the branch **and** the directory `fix-the-login-bug`, from a freshly fetched `origin/<default>`. A project can put an executable at `.glrs/hooks/wt_new` to do whatever a fresh worktree needs — install dependencies, copy a `.env` across; it is handed the worktree directory as its argument and in `WORKTREE_DIR`/`REPO_NAME`, and a hook that fails warns rather than costing you the worktree.

Four things it deliberately does differently from the tool it replaces:

- **git is the source of truth**, not a registry file. A registry drifts, self-rewrites on every read, and once it has any entry it stops falling back to git — so a worktree made with plain `git worktree add` becomes invisible. `git worktree list --porcelain` cannot go stale.
- **A name already taken is refused.** The old behaviour was `git branch -D` on a collision, which throws away whatever was on that branch.
- **No upstream is set.** Branching from a remote-tracking start point sets one automatically, so a fresh branch reported "up to date with origin/main" however far it had diverged; `--no-track` is what actually leaves it unset, and `git push -u` sets the right one.
- **Unpushed commits are measured against the branch's own remote**, not against the base — a branch fully pushed to its own remote used to count as unpushed and be skipped forever.

Removal stays yours. The skill tells the agent to run `doctor` and report, and to hand you the command rather than run it: deleting a worktree deletes a directory, and deciding what is safe needs judgement about work the agent may not be able to see.

Two bugs the tests caught while building this, both of the same shape: git reports real paths, and on macOS `/var` is a symlink to `/private/var`. A computed path and a git-reported one for the same directory compared unequal, so the main checkout was offered up for removal as a worktree on a protected branch, and a session's recorded directory failed to match the worktree it was in — silent, and in the direction that deletes work.
