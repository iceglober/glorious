# glorious

A simple terminal coding agent, stripped to the studs: a chat TUI over an agent
with **bash**, **read**, **write**, **edit**, **grep**, and **glob** tools,
driven by an Azure-hosted model. No modes, no permission prompts, no
configuration files — you talk, it reads and edits files and runs commands in
your repo.

The implementation lives in [`v2/`](v2/) — seven files of Bun TypeScript.

## Requirements

- **[Bun](https://bun.sh)** — the runtime. Install once; no separate build step.
- **Azure AI Foundry** — the wired model provider.
- **git** — the project root is the enclosing git worktree; search scoping uses it.

## Run it

```sh
bun add --global @glrs-dev/glorious@next       # install the prerelease channel
git clone git@github.com:iceglober/glorious.git && cd glorious  # or develop from source
```

```sh
export AZURE_OPENAI_API_KEY=…   # or AZURE_FOUNDRY_API_KEY / AZURE_API_KEY
export AZURE_RESOURCE_NAME=…     # your Azure AI Foundry resource
glorious                         # open a chat session in this repo
bun run glorious                 # same, from a source checkout
```

Environment:

- `AZURE_FOUNDRY_API_KEY` / `AZURE_API_KEY` / `AZURE_OPENAI_API_KEY` — the model key (required)
- `AZURE_RESOURCE_NAME` — the Azure AI Foundry resource
- `GLORIOUS_MODEL` — model override (default `gpt-5.6-luna`)
- `GLORIOUS_CONTEXT_SOFT_LIMIT` — optional request-context ceiling in tokens;
  old turns compact automatically at 75% of it

## The chat session

Type, and the agent works: it reads files, runs commands, and edits code, with
each finished tool call streaming into the transcript. Messages typed mid-turn
are queued and run in order. An `AGENTS.md` at the project root is folded into
the system prompt as project rules.

Keys:

- **Enter** — send. **Shift+Return** — newline. Large pastes collapse to a
  placeholder and expand back on submit.
- **Esc** — dequeue the newest waiting message back into the editor, or
  interrupt the running turn. The session survives; the model is told it was
  cut short.
- **Ctrl+C** — clear the input; on empty input it interrupts, and a double
  press quits.
- **↑/↓** or **Ctrl+P/N** — browse recent submitted prompts.
- Mouse-select pushes the selection to your clipboard (OSC 52).

## Built-in tools

- **bash** — runs in the project root on your machine; an interrupt kills the
  whole process group.
- **grep / glob** — ripgrep-powered, confined to the project root.
- **read / write / edit** — `edit` applies a batch of exact string replacements
  atomically, paired with a line-prefixed `read`.

Tool output over 30k chars is truncated for the model.

## Development

```sh
bun test docs           # tests
bun run typecheck       # tsc
bun run check           # biome lint + format
bun run docs            # regenerate docs/ from content/
```

Releases go through changesets; merging the release PR publishes to npm under
the `next` tag.
