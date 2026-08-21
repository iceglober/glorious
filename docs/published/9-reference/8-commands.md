---
title: commands
---

# commands

a **command** is a prompt you invoke by typing `/name`. three kinds, named by how
they are defined:

| kind | defined as | example |
| --- | --- | --- |
| **native** | code, through `g.command()` | `/help` |
| **markdown** | a `.md` file you write | `/review` |
| **skill command** | every [skill](./9-skills.md) answers to one | `/skill:graphify` |

native commands ship with glrs or come from any extension. origin is not the
axis; definition is.

## discovery

a command is a prompt you invoke with `/name`. a skill is instructions the model may choose, in any directory holding a `SKILL.md`. roots are read at startup and on `/reload`, four directories deep for skills. one namespace holds every command, filled by extensions, then skills, then markdown files; the first to claim a name wins. the core registers none, `builtins` registers all of the below.

| kind | roots, in order |
| --- | --- |
| commands | `<project root>`/.glrs/commands/*.md`, [`<user config>`](./14-configuration.md)`/commands/*.md` |
| skills | `<project root>`/.glrs/skills`, `<project root>`/.agents/skills`, `<user config>`/skills`, `~/.config/agents/skills`, then each loaded extension's `skills/` |

## what ships

| command | effect |
| --- | --- |
| `/help` | commands, keys, and extension flags |
| `/skills` | every skill, its origin, and whether the model is offered it |
| `/extensions [enable\|disable <name>]` | list loaded extensions, or record the choice in config |
| `/clear` | drop the conversation the model replays, keep the transcript |
| `/reload` | re-read extensions, skills and commands |
| `/compact [instruction]` | summarise the conversation so far |
| `/fork [n]` | copy the session to a new id, at event `n` or whole |
| `/session` | id, context, tokens, cost, events, file |

## command files

```markdown
---
description: open a pull request
---
open a PR for the current branch. $ARGUMENTS
```

frontmatter is optional and `description:` is its only field, the body is the prompt. `$ARGUMENTS` is everything typed after the name, `$1` to `$9` are its words. a body with neither still receives them, appended as `<arguments>…</arguments>`.

see also: [skills](./9-skills.md), [rules](./10-rules.md), [write a command](../2-how-to/4-write-a-command.md)
