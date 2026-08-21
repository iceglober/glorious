---
title: design
---

# design

glrs is a model, a turn loop, and a set of extensions over a git repository.

## small core

the core registers no commands and one tool. it discovers, it loads, it runs a
turn. everything the model can reach arrives through a public seam:

| seam | registers |
| --- | --- |
| `g.tool` | something the model can call |
| `g.command` | a slash command |
| `g.cli` | a subcommand on the `glrs` binary |
| `g.on` | a handler for a lifecycle event |
| `g.status`, `g.footer`, `g.activity` | parts of the screen |

`/help` and `bash` are registered through `g.command` and `g.tool`, the same
members any extension uses. neither has a private path into the core.

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
| `model-picker` | `/model`, and the picker that opens when no model is set |
| `ask-user` | the `ask_user` tool and its widget, built on `g.ui.capture` |
| `web-fetch` | the `web_fetch` tool |
| `worktree` | the `glrs wt` subcommand and `/wt` |

all five load. asking you to turn one on puts a decision in front of you that you
had no way to evaluate. disable what you do not want, or shadow it with a file
of the same name: disk wins over first-party.

## choosing the model is not core either

the core carries a model or a null, and refuses a turn without one. it ships no
way to pick one, exactly as it ships no way to read a file. `model-picker` reads
the catalogue through `g.models()`, chooses through `g.setModel()`, and writes
the choice through `g.rememberModel()`. every one of those is a public member an
extension you write can call.

that is why the TUI now opens without a model. `/model` is a slash command, and
slash commands exist only inside a session, so refusing to open a session until
a model was set meant the only ways in were `--model` and `GLRS_MODEL`. what the
core owes is the state, not a picker: the status row says `no model`, a turn is
refused rather than sent, and `ModelInfo.missing` reports what each provider
wants so whatever fills the gap can say so ([models](../9-reference/4-models.md)).

## permissions

there is no permissions system. glrs runs with the permissions of its process:
any file you can edit, any command you can run. no sandbox, and nothing asks
before it acts.

one seam exists for building a gate. glrs fires `project_trust` when a session
opens, and refuses to start if a handler answers anything but `trusted`. no
extension ships one, so out of the box the event fires and nothing listens
([events](../9-reference/12-events.md)). a gate built on it still runs in the
same process.

an extension can refuse a call from the `tool_call` hook, but it runs in the
same process as the thing it is refusing.

real boundaries come from outside the process:

- **containers** or micro-VMs, for work you do not want touching the host
- **virtual machines**, when the blast radius should include the kernel
- **git worktrees**, so a bad turn is one `git worktree remove` away
- **review before merge**, which is the boundary you already have

file tools resolve relative paths against the project root and take absolute
ones as given. nothing is refused. `bash` is unconfined, so a path check on the file tools
would stop nothing and cost a step.

see also: [a turn](./2-a-turn.md), [extensions](../9-reference/11-extensions.md), [tools](../9-reference/7-tools.md)
