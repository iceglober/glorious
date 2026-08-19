---
title: Commands
---

# Commands

## Slash commands from markdown

A file in `.glrs/commands/` becomes `/name`. Its body is the prompt.

```markdown
---
description: Review the working diff for anything that would fail CI
---

Read `git diff` and report anything that would fail CI. Do not fix it yet.
```

`$ARGUMENTS` and `$1`..`$9` expand. A body with no placeholder still gets the
arguments appended inside `<arguments>`, so `/review src/auth.ts` does not
silently drop the path.

Searched in Project `.glrs/commands/`, then User `commands/`. The User directory
is `~/.config/glrs` on macOS and Linux and `%APPDATA%\glrs` on Windows, unless
overridden. First name wins, and nothing is reserved — the core registers no commands, so a
file may claim `/clear` or `/help` if you want it to. Extensions register before
skills and command files, so the bundled ones win by default.

For a command that runs code instead of producing a prompt, register one from an
extension — see `extensions.md`.

## Skills

Skills follow the Agent Skills standard: a directory containing `SKILL.md` with
`name` and `description` frontmatter. The directory name must match `name`.

```markdown
---
name: verify
description: Drive the glrs TUI end-to-end and capture what it paints.
---

...instructions...
```

Every skill's name and description are listed to the model on each turn; the
body is loaded only when the model calls `activate_skill`, or when you type its
slash command. That is the point — a skill costs a line until it is used.

Discovered in Project `.glrs/skills/` and `.agents/skills/`, then User
`skills/` and the portable User `agents/skills/`. `/skills` lists what was found
and from where; `r` in that list reloads.

Another tool's directories are deliberately not read. glrs used to pick up
`~/.claude/skills`, `~/.claude/plugins/cache` and `~/.config/amp/skills`, which
turned someone else's whole skill surface into glrs slash commands — and put
every one of their descriptions in the per-turn preamble. Symlink one into
`.agents/skills/` if you want it here.

Skills answer under a `skill:` prefix — `/skill:changelog` — so installing one
cannot shadow a command you already had, and `/deploy` is never ambiguous about
where it came from. Completion is a fuzzy match, so typing `/changelog`
still finds it. A skill may declare `trigger: /name` to rename the part after
the colon; without one it is the skill's own name. See `skills.md`.

## AGENTS.md

`AGENTS.md`, `AGENT.md` or `CLAUDE.md` — the first that exists in a directory —
is read from the system root down to the project, plus `~/.config/agents/`, and
folded into the system prompt as `<repo-rules>`. `read` also appends any
`AGENTS.md` guidance from the directory of the file being read.

This is the cheapest place to put a standing instruction. It is part of the
cached prefix, so it costs nothing per turn.
