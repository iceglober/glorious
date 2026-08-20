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

```bash
/skill:graphify
```

`trigger: graph` in the frontmatter makes that `/skill:graph`.

## limit what it can reach

```markdown
allowed-tools: read, grep, glob
```

the model activating the skill is held to that list for the rest of the turn.
typing the slash command sends the body with nothing narrowed.
[tools](../9-reference/5-tools.md).

## where they are found

the project's `.glrs/skills/` and `.agents/skills/`, then the same two for the
user. the first root to claim a name keeps it. full list and every frontmatter
field: [instructions](../9-reference/6-instructions.md).

next: [set project rules](./6-set-project-rules.md)
