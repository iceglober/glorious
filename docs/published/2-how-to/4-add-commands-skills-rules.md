---
title: add commands, skills and rules
---

# add commands, skills and rules

## a command you invoke

`.glrs/commands/review.md`:

```markdown
---
description: review the working diff
---

review the working diff for anything that would fail CI. pay attention to $ARGUMENTS.
```

invoke it with `/review the migration`. the filename is the name, lowercased. frontmatter is optional: without it the whole file is the prompt.

`$ARGUMENTS` is everything after the name, `$1` to `$9` are its words. a body with no placeholder gets the arguments appended in an `<arguments>` block.

put the file in `<user config>/commands/` instead for every project. on a name clash the project file wins. `<user config>` is the directory [configuration](../9-reference/5-configuration.md) resolves.

## a skill the model chooses

`.glrs/skills/graphify/SKILL.md`:

```markdown
---
name: graphify
description: build a knowledge graph from notes. use when the user asks to map, link or graph a document.
---

1. read every file named in the request.
2. emit nodes, then edges.
```

`name` and `description` are required; without either the skill does not load and says why at startup. the model sees the name and description, not the body, so write the description as when to use this.

it also answers to `/skill:graphify`. `trigger: graph` in the frontmatter makes that `/skill:graph`.

skills are read from the project's `.glrs/skills/` and `.agents/skills/`, then the same two for the user, in that order. the first root to claim a name keeps it.

## rules that always apply

`AGENTS.md` at the project root rides in the system prompt on every turn.

```markdown
- run `bun check` before calling a change done.
- match the file you are editing: naming, layout, error handling.
```

every directory from your home directory down to the working directory is read, nearest last. `~/.config/glrs/AGENTS.md` applies everywhere. `AGENT.md` and `CLAUDE.md` are read when `AGENTS.md` is absent.

`/reload` re-reads commands, skills and extensions. rules are read once, at startup.
