---
name: worktree
description: Isolate a piece of work in its own git worktree, and work across worktrees from one session. Use when a task should not disturb the current branch, when work must continue while something else is mid-review, or when auditing which worktrees are still in use.
---

# worktree

A worktree is a second checkout of the same repository on its own branch, in its
own directory. The repository's history is shared; only the working files and the
branch differ.

Reach for one when the work should not disturb what is already in the current
checkout — a fix that must not sit on top of half-finished changes, or a second
line of work while the first is in review.

Do not reach for one for ordinary work. A branch in the current checkout is
simpler and costs nothing to switch away from.

## Making one

```
/wt new <short description of the work>
```

The description becomes both the branch and the directory:
`/wt new fix the login redirect` creates the branch `fix-the-login-redirect` in
`~/.glrs/worktrees/<repo>/fix-the-login-redirect`, branched from a freshly
fetched `origin/<default branch>`.

If the project has an executable at `.glrs/hooks/wt_new`, it runs in the new
worktree — that is where a project installs dependencies or copies a `.env`
across. If it fails you are told, and the worktree is still there.

The session remembers what it created. From then on every turn lists the open
worktrees and their absolute paths, so you do not have to hold them.

## Working in one

**This session does not move.** Its root stays the directory glrs was started
in, and a relative path still resolves there. To work in a worktree, use
absolute paths:

```
read /Users/you/.glrs/worktrees/repo/fix-the-login-redirect/src/auth.ts
edit  (same absolute path)
bash cd /Users/you/.glrs/worktrees/repo/fix-the-login-redirect && bun test
```

Every `bash` command that should run in the worktree needs its own `cd` — each
one starts fresh in the session's root.

Two mistakes to avoid:

- **Reading the wrong copy.** `src/auth.ts` is the *original* checkout's file,
  not the worktree's. If the file you are editing and the tests you are running
  disagree, this is why.
- **Committing in the wrong place.** `bash git commit` without a `cd` commits in
  the original checkout, on whatever branch it has out.

## Checking what exists

```
/wt list          worktrees for this repository
/wt list --all    every repository that has any
/wt doctor        what is in use, what is stale, what is safe to remove
```

`doctor` is the one worth running before suggesting any cleanup. For each
worktree it reports whether a session has been working there recently,
uncommitted changes, unpushed commits, and whether the branch is merged. glrs
records the directory every session ran in, which is how it can tell the
difference between abandoned and in use.

## Removing one

**Removal is the user's, not yours.** Deleting a worktree deletes a directory,
and `doctor` exists because deciding what is safe needs judgement about work you
may not be able to see.

Run `/wt doctor` and report what it says. If something looks removable, say so
and give them the command:

```
glrs wt rm <branch>          one, refusing if it is dirty
glrs wt clean --dry-run      everything doctor calls safe, listed not removed
glrs wt clean --yes          and then actually removed
```

Do not run these yourself, and do not `bash git worktree remove` around them.

## What this is not

Working across worktrees is one agent — this session — moving between
directories. Nothing here starts a second agent, and nothing runs in parallel.
Creating three worktrees does not get three things done at once; it gets you
three places to do one thing at a time.
