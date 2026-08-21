---
title: skills
---

# skills

a **skill** is instructions the model loads when it judges them relevant. you
invoke a [command](./8-commands.md); the model activates a skill.

glrs implements the [Agent Skills specification](https://agentskills.io/specification).
two fields below are extensions to it, marked where they appear.

## frontmatter

| field | effect |
| --- | --- |
| `name` | required. the skill's name |
| `description` | required. what the model reads to decide |
| `trigger` | renames the command to `/skill:<trigger>` |
| `allowed-tools` | tools the turn is held to, comma or space separated |
| `disable-model-invocation` | `true` withholds it from the model, leaving the command. a convention, not part of the Agent Skills standard |
| `license`, `compatibility`, `metadata` | parsed, offered to extensions by `g.inspect()`, not acted on |

every skill answers to `/skill:<name>` and unknown fields are ignored. `allowed-tools` binds only when the model calls `activate_skill`: the rest of that turn keeps that list plus `activate_skill`, composed with `tools.disable`; typing the command restricts nothing. a skill with no frontmatter, no closing `---`, no `name`, or no `description` does not load, and a duplicate name loads the first only. an over-long or off-standard name, a description over 1024 characters, a `compatibility` over 500, or a directory named differently from the skill each warn and load. warnings print as `(skill) …` in the transcript, `[skill] …` under `-p`.

## where they are found

the project's `.glrs/skills/` and `.agents/skills/`, then the same two under your
home directory, then `~/.config/agents/skills/`, then each loaded extension's
`skills/`. the first root to claim a name keeps it.

## the skill command

every skill answers to `/skill:<name>`, or `/skill:<trigger>` when `trigger` is
set. typing it sends the body with nothing narrowed; the model activating the
skill through `activate_skill` is held to `allowed-tools` for the rest of the
turn.

see also: [commands](./8-commands.md), [tools](./7-tools.md), [write a skill](../2-how-to/5-write-a-skill.md)
