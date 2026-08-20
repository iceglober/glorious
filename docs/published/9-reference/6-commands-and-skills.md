---
title: commands and skills
---

# commands and skills

## discovery

a command is a prompt you invoke with `/name`. a skill is instructions the model may choose, in any directory holding a `SKILL.md`. roots are read at startup and on `/reload`, four directories deep for skills. one namespace holds every command, filled by extensions, then skills, then markdown files; the first to claim a name wins. the core registers none, `builtins` registers all of the below.

| kind | roots, in order |
| --- | --- |
| commands | `<root>/.glrs/commands/*.md`, [`<user config>`](./5-configuration.md)`/commands/*.md` |
| skills | `<root>/.glrs/skills`, `<root>/.agents/skills`, `<user config>/skills`, `~/.config/agents/skills`, then each loaded extension's `skills/` |

## built-in commands

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

```md
---
description: open a pull request
---
open a PR for the current branch. $ARGUMENTS
```

frontmatter is optional and `description:` is its only field, the body is the prompt. `$ARGUMENTS` is everything typed after the name, `$1` to `$9` are its words. a body with neither still receives them, appended as `<arguments>…</arguments>`.

## skill frontmatter

| field | effect |
| --- | --- |
| `name` | required. the skill's name |
| `description` | required. what the model reads to decide |
| `trigger` | renames the command to `/skill:<trigger>` |
| `allowed-tools` | tools the turn is held to, comma or space separated |
| `disable-model-invocation` | `true` withholds it from the model, leaving the command. a convention, not part of the Agent Skills standard |
| `license`, `compatibility`, `metadata` | parsed, offered to extensions by `g.inspect()`, not acted on |

every skill answers to `/skill:<name>` and unknown fields are ignored. `allowed-tools` binds only when the model calls `activate_skill`: the rest of that turn keeps that list plus `activate_skill`, composed with `tools.disable`; typing the command restricts nothing. a skill with no frontmatter, no closing `---`, no `name`, or no `description` does not load, and a duplicate name loads the first only. an over-long or off-standard name, a description over 1024 characters, a `compatibility` over 500, or a directory named differently from the skill each warn and load. warnings print as `(skill) …` in the transcript, `[skill] …` under `-p`.

## AGENTS.md

every text found is concatenated, nearest last: `/etc/ampcode/AGENTS.md` and `/etc/glrs/AGENTS.md` (macOS adds `/Library/Application Support/…`, Windows uses `%ProgramData%`), then `~/.config/amp/AGENTS.md`, `~/.config/glrs/AGENTS.md`, `~/.config/AGENTS.md`, then every directory from `$HOME` down to the working directory. in those directories the first of `AGENTS.md`, `AGENT.md`, `CLAUDE.md` is read.
