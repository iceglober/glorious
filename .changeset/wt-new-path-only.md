---
"@glrs-dev/glrs": patch
---

`glrs wt new` prints the path and nothing else, and works when the remote is empty.

```bash
cd $(glrs wt new fix the login redirect)
```

Two things stopped that working.

**The path is the whole output.** `wt new` printed the path plus the branch it came from, so `$(…)` captured both. The branch line is gone: the directory is named after the branch and the base is the default, so it never said anything you could not see. A `wt_new` hook that failed writes to stderr, where it is visible when you are watching and absent when you are capturing.

**`--cd` opens a shell in the new worktree.** A process cannot change the directory of the shell that started it, so this starts one rather than pretending; `exit` returns you.

**A base that only exists locally could not be branched from.** `defaultBranch` falls back to `refs/heads/main` when there is no `origin/main`, but `create` then ran `git fetch origin main` unconditionally, which can only fail for a base git resolved locally. The fallback was unreachable, and `glrs wt new` was impossible in any repository whose remote is empty or that has never pushed:

```
could not fetch origin/main: fatal: couldn't find remote ref main
```

`startPoint` now tries the remote first, because that is also what refreshes it, and stands on the local ref only when the remote has nothing. When neither exists the failure names both: `no origin/x and no local x`.
