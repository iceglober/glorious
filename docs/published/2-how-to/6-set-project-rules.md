---
title: set project rules
---

# set project rules

rules ride in the system prompt on every turn. unlike a
[command](./4-write-a-command.md) or a [skill](./5-write-a-skill.md), nothing
invokes them.

## write them

`AGENTS.md` at the project root:

```markdown
- run `bun check` before calling a change done.
- match the file you are editing: naming, layout, error handling.
```

## where they are read from

every directory from your home directory down to the working directory, nearest
last. `~/.config/glrs/AGENTS.md` applies to every project.

`AGENT.md` and `CLAUDE.md` are read when `AGENTS.md` is absent, so a repository
written for another agent works unchanged.

## when they are read

`AGENTS.md` files from your home directory down to the project root are read once,
at startup. restart to pick up an edit; `/reload` does not re-read them.

a file's own directory is searched again every time a tool reads that file, so a
rule beside the code it governs takes effect immediately and applies only when
that code is opened. both paths: [rules](../9-reference/10-rules.md).

next: [manage extensions](./7-manage-extensions.md)

see also: [rules](../9-reference/10-rules.md)
