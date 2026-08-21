---
title: rules
---

# rules

rules are text that rides in the system prompt on every turn. nothing
invokes them.

## AGENTS.md

every text found is concatenated, nearest last: `/etc/ampcode/AGENTS.md` and `/etc/glrs/AGENTS.md` (macOS adds `/Library/Application Support/…`, Windows uses `%ProgramData%`), then `~/.config/amp/AGENTS.md`, `~/.config/glrs/AGENTS.md`, `~/.config/AGENTS.md`, then every directory from `$HOME` down to the working directory. in those directories the first of `AGENTS.md`, `AGENT.md`, `CLAUDE.md` is read.

## which directories are read

| when | read from |
| --- | --- |
| startup | every directory from your home directory down to the project root, nearest last |
| startup | `/etc/glrs/AGENTS.md` and the platform equivalents, plus `~/.config/glrs/AGENTS.md` |
| every `read` | the directory of the file being read, and its ancestors |

that last row is why a rule beside the code it governs applies when the model
opens that file, without being loaded for every unrelated turn.

`AGENT.md` and `CLAUDE.md` are read when `AGENTS.md` is absent, so a repository
written for another agent works unchanged.

## when they are re-read

startup only, except the per-`read` lookup above. `/reload` re-reads commands,
skills and extensions, not rules.

see also: [commands](./8-commands.md), [set project rules](../2-how-to/6-set-project-rules.md)
