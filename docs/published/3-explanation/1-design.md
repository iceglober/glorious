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

see also: [a turn](./3-a-turn.md), [permissions](./2-permissions.md), [extensions](../9-reference/7-extensions.md)
