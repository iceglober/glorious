---
title: design
---

# design

glrs is a simple agent: a model, tools, context, and a turn loop over a git repository.

## small core

tools, commands, skills, hooks, keys, status and rendering compose through public seams. the core registers no command and one tool, `activate_skill`. everything else arrives as an extension:

| extension | contributes |
| --- | --- |
| `builtins` | `bash`, `read`, `write`, `edit`, `grep`, `glob`, and `/help`, `/clear`, `/compact`, `/fork`, `/session`, `/skills`, `/extensions`, `/reload` |
| `ask-user` | the `ask_user` tool and its widget, built on `g.ui.capture` |
| `worktree` | the `glrs wt` subcommand and `/wt` |
| `web-fetch` | the `web_fetch` tool |

if `/help` or `bash` could not be written as one, the seam would be a claim.

## three hosts

`g.mode` names the surface: `tui` (an interactive session), `print` (`glrs -p`, one turn to stdout), `cli` (a subcommand such as `glrs wt list`, no model, no screen).

all three build the same agent over the same config, extensions and skills. a member with no meaning in a host throws rather than doing nothing quietly, so an extension needing a screen checks `g.hasUI` first.

`@glrs-dev/glrs` exports `createCodingAgent`, so a fourth host can be an application that is not glrs.

## no default model

a default provider guesses whose account is billed and which endpoint sees the traffic. glrs guesses neither: `provider/model-id`, always. no turn runs without one.

## the docs are the contract

`docsPath()` points the agent at `docs/published`, never at `packages/`. what it can read about itself is what it may depend on. a wrong sentence here becomes a wrong extension later.

## glossary

- **steering**: a message that joins the running turn at its next step boundary
- **follow-up**: a message that waits until the agent has run out of work
- **variant**: reasoning effort: `minimal`, `low`, `medium`, `high`
- **TUI**: the full-screen terminal interface, the surface `glrs` opens with no arguments
- **host**: the surface a session runs on: `tui`, `print`, `cli`
- **project root**: `git rev-parse --show-toplevel`, or the working directory outside a repo
- **cache breakpoint**: a mark on the second-to-last message; Anthropic and Bedrock cache everything up to it

## permissions
# permissions

glrs runs with the permissions of its process: any file you can edit, any
command you can run. there is no sandbox and no approval prompt.

## paths

the file tools resolve relative paths against the project root and take
absolute ones as given. nothing is refused: `bash` sits unconfined beside them,
so a path check would only send the model the long way round.

## boundaries

a confirmation prompt is not a boundary once an agent can edit and execute
code. an extension can refuse a call from the `tool_call` hook, but it runs in
the same process. real boundaries come from outside: git review, worktrees,
containers, or operating-system controls.

see also: [a turn](./2-a-turn.md), [design](./1-design.md), [extensions](../9-reference/7-extensions.md)
