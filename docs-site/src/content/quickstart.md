# Quickstart

## Install

```sh
bun add --global @glrs-dev/glorious@next
```

Requires [Bun](https://bun.sh) ≥ 1.2 and git. See [install](/install).

## Set the model key

```sh
export AZURE_FOUNDRY_API_KEY=…   # or AZURE_API_KEY
export AZURE_RESOURCE_NAME=…     # your Azure AI Foundry resource
```

`GLORIOUS_MODEL` overrides the default model (`gpt-5.6-luna`).

## Open a session

From inside a git repo:

```sh
glorious
```

Type, and the agent reads and edits files and runs commands as you chat.

## Keys

- **Enter** submits; **Shift+Enter** inserts a newline.
- **Esc** removes the newest queued message, then interrupts the running turn.
- **Ctrl+C** clears the composer; twice on an empty composer exits.
- **Up/Down** browse prompt history.
- Mouse-select copies to the clipboard.

## Next

- [tools](/tools)
- [cli](/cli)
