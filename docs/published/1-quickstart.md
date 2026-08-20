---
title: quickstart
---

# quickstart

## install

```sh
curl -fsSL https://glrs.dev/install.sh | bash
```

more options on [installation](./2-installation.md)

## configure a model

a model is required. use a fully qualified `provider/model-id`.

### anthropic

```sh
export ANTHROPIC_API_KEY=...
export GLRS_MODEL=anthropic/claude-opus-5
```

### openai

```sh
export OPENAI_API_KEY=...
export GLRS_MODEL=openai/gpt-5.6-sol
```

see [models](./4-models.md) for every provider and configuration-file options.

## run a session

from inside a git repo:

```sh
glrs
```

type a message in the composer:

```
> describe this project to me
```

glrs can read and edit files, search the repo, and run shell commands. it has
the same permissions as the process that launched it.

press `ctrl+c` twice on an empty composer to exit. glrs prints the session ID
and its resume command:

```sh
glrs --resume <id>
```

run `glrs --resume` without an ID to choose from earlier sessions.

## slash commands

| command                  | action                                                 |
| ------------------------ | ------------------------------------------------------ |
| `/help`                  | list commands and keys                                 |
| `/skills`                | list available skills                                  |
| `/extensions`            | list loaded and available extensions                   |
| `/reload`                | reload skills, commands, extensions, and tool settings |
| `/clear`                 | clear model context; keep the transcript               |
| `/compact [instruction]` | summarize older context                                |
| `/session`               | show session usage and storage                         |

## keys

| key                 | action                                                             |
| ------------------- | ------------------------------------------------------------------ |
| `enter`             | send; while busy, queue a follow-up turn                           |
| `alt+enter`         | steer the running turn at its next step                            |
| `shift+enter`       | insert a newline                                                   |
| `alt+↑`             | return the newest queued message to the composer                   |
| `esc`               | close completion; otherwise stop the turn and hold queued messages |
| `ctrl+c`            | clear; interrupt; press again to exit                              |
| `↑` / `↓`           | move through completion or prompt history at the draft edges       |
| `ctrl+p` / `ctrl+n` | move through prompt history anywhere                               |
| `tab`               | fill the selected completion                                       |
| `/`                 | complete a slash command                                           |
| `@`                 | attach a file or directory                                         |
| `!`                 | enter direct shell mode                                            |
| `backspace`         | leave an empty direct shell composer                               |
| mouse drag          | select and copy through OSC 52                                     |

on Windows Terminal, `alt+enter` needs a one-time remap. see
[terminal setup](./4-reference/2-terminal-setup.md).
