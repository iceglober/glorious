---
title: write a skill
---

# write a skill

a skill is instructions the model loads when it decides they apply. a
[command](./4-write-a-command.md) is one you invoke yourself.

## write it

`.glrs/skills/graphify/SKILL.md`:

```markdown
---
name: graphify
description: build a knowledge graph from notes. use when the user asks to map, link or graph a document.
---

1. read every file named in the request.
2. emit nodes, then edges.
```

## the description is the trigger

the model sees the name and description, not the body. write the description as
*when to use this*, not as what it is.

`name` and `description` are required. without either the skill does not load
and says so at startup.

## invoke it yourself

every skill answers to a skill command:

```bash
/skill:graphify
```

`trigger: graph` makes that `/skill:graph`.

## limit what it can reach

```markdown
allowed-tools: read, grep, glob
```

the model activating the skill is held to that list for the rest of the turn.
typing the slash command sends the body with nothing narrowed.
[tools](../9-reference/7-tools.md).

## the specification

glrs implements the [Agent Skills specification](https://agentskills.io/specification).
worth reading before writing more than one:
[best practices](https://agentskills.io/skill-creation/best-practices) and
[optimizing descriptions](https://agentskills.io/skill-creation/optimizing-descriptions).

two fields glrs reads are not in the specification:

| field | what it does |
| --- | --- |
| `disable-model-invocation` | hides the skill from the model, leaving only the skill command. popularised by Claude Code and widely recognised |
| `trigger` | renames the skill command |

## where they are found

four roots, project before user, first to claim a name wins:
[skills](../9-reference/9-skills.md).

next: [set project rules](./6-set-project-rules.md)
