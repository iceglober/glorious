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

prints the path, and nothing else:

```bash
cd $(glrs wt new fix the login redirect)
```

a `wt_new` hook that failed writes to stderr, so it is visible when you are
watching and absent from `$(…)`. the worktree still stands.

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
