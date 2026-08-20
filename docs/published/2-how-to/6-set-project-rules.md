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

once, at startup. `/reload` re-reads commands, skills and extensions, not rules.
restart to pick up an edit.

see also: [commands and skills](../9-reference/6-commands-and-skills.md)
