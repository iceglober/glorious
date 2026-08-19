---
title: basics
---

# basics

## turns

a turn starts with one message and ends when the model finishes its tool work
and response. glrs can make several model calls inside one turn.

```sh
glrs -p "explain this repository"   # one headless turn
```

in print mode, assistant text goes to stdout and the tool trail goes to stderr.

## files

use `@` to attach a path:

```text
> review @src/auth.ts
```

a file sends its contents. a directory sends its listing. missing paths stay in
the prompt as text and produce a notice.

## shell

start the composer with `!` to run a command yourself:

```text
!git status
```

this is separate from the `bash` tool the model can call.

## messages while busy

| key | queue |
| --- | --- |
| `enter` | follow-up: starts after current work finishes |
| `alt+enter` | steering: joins the running turn at its next step |
| `alt+↑` | takes the newest queued message back |
| `esc` | stops the turn and holds the queue |

press `enter` on an empty composer to release a held queue.

## rules

glrs reads the first `AGENTS.md`, `AGENT.md`, or `CLAUDE.md` in each directory
from your home directory down to the project. for projects outside home, the
walk starts at the filesystem root. nearer rules come later. system and User
rules are read first. `read` also returns guidance beside the target file.

## reusable behavior

- a **command** is a prompt you invoke with `/name`
- a **skill** is instructions the model can choose to load
- an **extension** is TypeScript that adds tools, hooks, commands, or UI

see [commands](./commands.md), [skills](./skills.md), and
[extensions](./extensions.md).
