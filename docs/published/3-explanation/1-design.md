---
title: design
---

# design

glrs is a model, a turn loop, and a set of extensions over a git repository.

## small core

the core registers no tools and no commands. it discovers, it loads, it runs a
turn. everything the model can reach arrives through a public seam:

| seam | registers |
| --- | --- |
| `g.tool` | something the model can call |
| `g.command` | a slash command |
| `g.cli` | a subcommand on the `glrs` binary |
| `g.on` | a handler for a lifecycle event |
| `g.status`, `g.footer`, `g.activity` | parts of the screen |

the seam is only real if the obvious things are built on it. if `/help` or
`bash` needed a private door, the claim would be decoration.

one tool is core: `activate_skill`. skills are a core concept, discovered and
catalogued by the core and injected into every prompt, and that tool is the
subsystem's own accessor rather than a capability. the tenet is that no
capability is built in.

## builtins

even the primitive tools are an extension. `bash`, `read`, `write`, `edit`,
`grep` and `glob` come from `builtins`, which also registers every slash
command. disable it and the model has nothing to work with, which is the point:
the core does not quietly keep a copy.

## first-party extensions

| extension | provides |
| --- | --- |
| `builtins` | the file, search and shell tools, and every slash command |
| `ask-user` | the `ask_user` tool and its widget, built on `g.ui.capture` |
| `web-fetch` | the `web_fetch` tool |
| `worktree` | the `glrs wt` subcommand and `/wt` |

all four load. asking you to turn one on put a decision in front of you that you
had no way to evaluate. disable what you do not want, or shadow it with a file
of the same name: disk wins over first-party.

## permissions

there is no permissions system. glrs runs with the permissions of its process:
any file you can edit, any command you can run. no sandbox, no approval prompt.

a confirmation prompt is not a boundary once an agent can edit and execute code.
an extension can refuse a call from the `tool_call` hook, but it runs in the
same process.

real boundaries come from outside the process:

- **containers** or micro-VMs, for work you do not want touching the host
- **virtual machines**, when the blast radius should include the kernel
- **git worktrees**, so a bad turn is one `git worktree remove` away
- **review before merge**, which is the boundary you already have

file tools resolve relative paths against the project root and take absolute
ones as given. nothing is refused, because `bash` sits unconfined beside them
and a path check would only send the model the long way round.

see also: [a turn](./2-a-turn.md), [extensions](../9-reference/11-extensions.md), [tools](../9-reference/7-tools.md)
