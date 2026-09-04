---
"@glrs-dev/glrs": patch
---

`glrs wt new` prints the path and nothing else, and works when the remote is empty.

```bash
cd $(glrs wt new fix the login redirect)
```

Two things stopped that working.

**The path was not alone on stdout.** `wt new` printed the path plus the branch it came from and any hook note, so `$(…)` captured all three. The commentary goes to stderr now, where it is still visible when you are watching and absent when you are capturing. `/wt new` in a session is unchanged: one surface, so it prints both.

**A base that only exists locally could not be branched from.** `defaultBranch` falls back to `refs/heads/main` when there is no `origin/main`, but `create` then ran `git fetch origin main` unconditionally, which can only fail for a base git resolved locally. The fallback was unreachable, and `glrs wt new` was impossible in any repository whose remote is empty or that has never pushed:

```
could not fetch origin/main: fatal: couldn't find remote ref main
```

`startPoint` now tries the remote first, because that is also what refreshes it, and stands on the local ref only when the remote has nothing. When neither exists the failure names both: `no origin/x and no local x`.
