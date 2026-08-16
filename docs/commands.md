# Commands and skills

## Slash commands from markdown

A file in `.glorious/commands/` becomes `/name`. Its body is the prompt.

```markdown
---
description: Review the working diff for anything that would fail CI
---

Read `git diff` and report anything that would fail CI. Do not fix it yet.
```

`$ARGUMENTS` and `$1`..`$9` expand. A body with no placeholder still gets the
arguments appended inside `<arguments>`, so `/review src/auth.ts` does not
silently drop the path.

Searched in `.glorious/commands/`, `.agents/commands/`, `.claude/commands/` up
the directory tree, then `~/.config/agents/commands/` and `~/.claude/commands/`.
First name wins. A built-in always beats a file, so a command file cannot
capture `/clear` and quietly change what it does.

For a command that runs code instead of producing a prompt, register one from an
extension — see `extensions.md`.

## Skills

Skills follow the Agent Skills standard: a directory containing `SKILL.md` with
`name` and `description` frontmatter. The directory name must match `name`.

```markdown
---
name: verify
description: Drive the glorious TUI end-to-end and capture what it paints.
---

...instructions...
```

Every skill's name and description are listed to the model on each turn; the
body is loaded only when the model calls `activate_skill`, or when you type its
slash command. That is the point — a skill costs a line until it is used.

Discovered under `.agents/skills/`, `.claude/skills/` up the tree, plus
`~/.config/agents/skills/` and `~/.claude/skills/`. `/skills` lists what was
found and from where; `r` in that list reloads.

A skill may declare `trigger: /name` to rename its slash command. Without one
the command is the skill's own name.

## AGENTS.md

`AGENTS.md`, `AGENT.md` or `CLAUDE.md` — the first that exists in a directory —
is read from the system root down to the project, plus `~/.config/agents/`, and
folded into the system prompt as `<repo-rules>`. `read` also appends any
`AGENTS.md` guidance from the directory of the file being read.

This is the cheapest place to put a standing instruction. It is part of the
cached prefix, so it costs nothing per turn.
