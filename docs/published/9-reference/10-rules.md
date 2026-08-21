---
title: rules
---

# rules

rules are text that reaches the model without anyone invoking it. they come from
`AGENTS.md`, and from `AGENT.md` or `CLAUDE.md` when that is absent, so a
repository written for another agent works unchanged.

```markdown
- run `bun check` before calling a change done.
- match the file you are editing: naming, layout, error handling.
```

## two kinds, arriving two ways

| kind | read | arrives in |
| --- | --- | --- |
| startup rules | once, when glrs opens | the system prompt |
| a file's own rules | every time a tool reads a file | that read's result |

this distinction matters. the system prompt is byte-identical on every turn, so
that a provider's cache keeps hitting ([a turn](../3-explanation/2-a-turn.md)).
rules discovered mid-session cannot go there, so they ride back with the file
that brought them, under `AGENTS.md guidance:`.

## startup rules

read once, from every directory between your home directory and the project
root, nearest last:

| location | applies to |
| --- | --- |
| `/etc/glrs/AGENTS.md` | every project on the machine |
| `~/.config/glrs/AGENTS.md` | every project of yours |
| `~/.config/AGENTS.md` | every agent you run, not only glrs |
| each directory down to `<project root>` | that directory and below |

on macOS `/Library/Application Support/glrs/AGENTS.md` is read too; on Windows
`%ProgramData%\glrs\AGENTS.md`.

glrs also reads amp's machine-wide locations (`/etc/ampcode/AGENTS.md` and
`~/.config/amp/AGENTS.md`) for the same reason it reads `CLAUDE.md`: a machine
already set up for another agent works without being set up again.

## a file's own rules

when a tool reads a file, glrs looks for rules in that file's own directory and
its ancestors, and appends what it finds to the result the model sees.

a rule beside the code it governs therefore applies when the model opens that
code, and costs nothing on turns that never touch it.

## when they are re-read

startup rules are read once. `/reload` re-reads commands, skills and extensions,
not rules; restart to pick up an edit. a file's own rules are read on every
`read`, so editing one takes effect immediately.

see also: [commands](./8-commands.md), [set project rules](../2-how-to/6-set-project-rules.md)
