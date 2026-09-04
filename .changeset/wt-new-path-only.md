---
"@glrs-dev/glrs": patch
---

`glrs wt new` prints the path and nothing else, and works when the remote is empty.

```bash
cd $(glrs wt new fix the login redirect)
```

Two things stopped that working.

**The output is what ran, then where it is.** `wt new` used to print the path, the branch it came from, and a note only if a hook failed. It now logs each hook that ran, with `cd <path>` last:

```
ran .glrs/hooks/wt_new
cd /Users/you/.glrs/worktrees/myrepo/fix-the-login-redirect
```

A hook that ran silently and a hook that was never there used to look identical, which is the wrong thing to be quiet about when the hook is what installs your dependencies. The branch line is gone: the directory is named after the branch and the base is the default.

**`--cd` opens a shell in the new worktree.** A process cannot change the directory of the shell that started it, so this starts one instead of pretending; `exit` returns you. To move the shell you are already in, run the last line: `eval "$(glrs wt new … | tail -1)"`.

**A base that only exists locally could not be branched from.** `defaultBranch` falls back to `refs/heads/main` when there is no `origin/main`, but `create` then ran `git fetch origin main` unconditionally, which can only fail for a base git resolved locally. The fallback was unreachable, and `glrs wt new` was impossible in any repository whose remote is empty or that has never pushed:

```
could not fetch origin/main: fatal: couldn't find remote ref main
```

`startPoint` now tries the remote first, because that is also what refreshes it, and stands on the local ref only when the remote has nothing. When neither exists the failure names both: `no origin/x and no local x`.
