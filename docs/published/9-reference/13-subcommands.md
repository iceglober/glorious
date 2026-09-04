---
title: subcommands
---

# subcommands

a subcommand runs deterministic work and exits. no session, no model, no
alternate screen.

```bash
glrs wt list
```

## wt new

what ran, then where it is. the last line is the command that takes you there:

```
$ glrs wt new fix the login redirect
ran .glrs/hooks/wt_new
cd /Users/you/.glrs/worktrees/myrepo/fix-the-login-redirect
```

a hook that failed says so and the worktree still stands:

```
ran .glrs/hooks/wt_new, failed: exit 3
cd /Users/you/.glrs/worktrees/myrepo/fix-the-login-redirect
```

with no hook the log is empty and `cd …` is the whole output.

### --cd

```bash
glrs wt new fix the login redirect --cd
```

opens a shell in the new worktree. a process cannot change the directory of the
shell that started it, so this starts one rather than pretending: `exit` returns
you to where you were. inside a session `--cd` has no shell to open and says so.

to move the shell you are already in, run the last line:

```bash
eval "$(glrs wt new fix the login redirect | tail -1)"
```

## how one is found

the first bare word glrs does not claim is offered to the extensions, which load
to answer it. an unclaimed word is `Unknown subcommand 'x'.` plus the help text,
exit 1.

`--help` is the only other route that loads extensions, which is why it can list
what they added.

## what ships

| subcommand | from | does |
| --- | --- | --- |
| `wt` | the `worktree` extension | creates and audits git worktrees |
| `update` | glrs | runs `bun add -g @glrs-dev/glrs@next` |
| `doctor` | glrs | reports what would run, without running it |

## what a subcommand can reach

`g.print` goes to stdout undecorated, so output pipes. `g.root` and `g.exec`
work. every member of the extension API that needs a session throws, naming
itself:

```text
g.model() needs a session, and a glrs subcommand runs outside one.
```

## adding one

```typescript
g.cli("wt", { description: "manage git worktrees", run: (args) => {} });
```

`args` is everything after the subcommand name. glrs does not interpret it.

see also: [extensions](./11-extensions.md), [cli](./1-cli.md)
