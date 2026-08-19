---
title: Quickstart
---

# Quickstart

## Install

Installation options, package-manager commands, and update instructions live on
the [Install](./2-install.md) page.

## Set the model key

```sh
export AZURE_OPENAI_API_KEY=…   # or AZURE_FOUNDRY_API_KEY / AZURE_API_KEY
export AZURE_RESOURCE_NAME=…     # your Azure AI Foundry resource
```

`GLRS_MODEL` overrides the default model (`gpt-5.6-luna`).

## Open a session

From inside a git repo:

```sh
glrs
```

Type, and the agent reads and edits files and runs commands as you chat.
`glrs --resume` reopens an earlier session.

## Slash commands

- `/help` — keys and commands.
- `/skills` — list discovered skills; press `r` to reload from disk.
- `/extensions` — list loaded extensions and what each one registered.
- `/clear` — drop the conversation the model replays, keeping the transcript.

Reusable behavior belongs in a TypeScript extension. Extensions are user-invoked,
never selected by the model, and can register tools, commands, hooks, or UI.
The `!` prefix remains available for one-off shell commands.

## Keys

- **Enter** submits; **Shift+Enter** inserts a newline.
- **Esc** removes the newest queued message, then interrupts the running turn.
- **Ctrl+C** clears the composer; twice on an empty composer exits.
- **↑/↓** or **Ctrl+P/N** browse prompt history.
- **!** as the first character runs the line as a shell command instead of
  sending it to the model. **Backspace** on an empty line leaves.
- Mouse-select copies to the clipboard.

## Project rules and skills

glrs reads `AGENTS.md`, `AGENT.md` or `CLAUDE.md` from the working
directory upwards, nearer files last. Skills — a directory with a `SKILL.md`
carrying `name` and `description` frontmatter — are discovered the same way;
only the name and description are loaded until the agent activates one.

## Next

- [Tools](./tools.md)
- [CLI](./cli.md)
