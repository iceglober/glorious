# Quickstart

## Install

```sh
curl -fsSL https://glrs.dev/install.sh | bash
```

That checks for [Bun](https://bun.sh) and git, offers to install Bun if it is
missing, then installs glorious. Or do it yourself:

```sh
bun add --global @glrs-dev/glorious@next
```

## Set the model key

```sh
export AZURE_OPENAI_API_KEY=…   # or AZURE_FOUNDRY_API_KEY / AZURE_API_KEY
export AZURE_RESOURCE_NAME=…     # your Azure AI Foundry resource
```

`GLORIOUS_MODEL` overrides the default model (`gpt-5.6-luna`).

## Open a session

From inside a git repo:

```sh
glorious
```

Type, and the agent reads and edits files and runs commands as you chat.
`glorious --resume` reopens an earlier session.

## Slash commands

- `/help` — keys and commands.
- `/skills` — list discovered skills; press `r` to reload from disk.
- `/extensions` — list loaded extensions and what each one registered.
- `/clear` — drop the conversation the model replays, keeping the transcript.

## Sequences

A slash command always ends in a turn; `!` never does but has to be typed out
in full. A sequence is the named form of `!` — a script the project defines
and glorious runs, reached by typing `$` and completing the name.

Put one in `.glorious/sequences/<name>.md`. The frontmatter is the
deterministic part; the body is an optional prompt.

```markdown
---
description: Reset to a clean main
run: |
  git checkout main
  git pull --ff-only
clear: true
---

The working tree was reset. Anything you knew about the previous branch is
stale — re-read before acting.
```

- `run` is the shell, and always executes. Arguments arrive as real positional
  parameters, so `$fresh main` gives the script `$1`.
- **With a body**, a turn is sent once the shell succeeds, carrying the
  script's stdout as evidence. `run: git diff` plus "review this" is a whole
  workflow in one file.
- **Without a body, no turn is produced at all.** The model is never called.
- `clear` drops the conversation, for a script that changes the ground the
  model was standing on.
- A non-zero exit shows the output and stops there: nothing is sent, nothing is
  cleared.

Extensions are yours to invoke, never the model's — it cannot decide to reset
your working tree. `/skills` reloads them along with everything else.

## Keys

- **Enter** submits; **Shift+Enter** inserts a newline.
- **Esc** removes the newest queued message, then interrupts the running turn.
- **Ctrl+C** clears the composer; twice on an empty composer exits.
- **↑/↓** or **Ctrl+P/N** browse prompt history.
- **!** as the first character runs the line as a shell command instead of
  sending it to the model. **Backspace** on an empty line leaves.
- Mouse-select copies to the clipboard.

## Project rules and skills

glorious reads `AGENTS.md`, `AGENT.md` or `CLAUDE.md` from the working
directory upwards, nearer files last. Skills — a directory with a `SKILL.md`
carrying `name` and `description` frontmatter — are discovered the same way;
only the name and description are loaded until the agent activates one.

## Next

- [tools](/tools)
- [cli](/cli)
