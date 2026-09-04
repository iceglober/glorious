---
title: subcommands
---

# subcommands

a subcommand runs deterministic work and exits. no session, no model, no
alternate screen.

```bash
glrs wt list
```

## streams

a subcommand's stdout is the answer and nothing else, so reading it and
capturing it give you the same thing. `glrs wt new` prints one line:

```bash
cd $(glrs wt new fix the login redirect)
```

anything that is not the answer goes to stderr, and there usually is nothing.
`wt new` writes there only when a `wt_new` hook failed.

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
