# glorious

A terminal coding agent, stripped to the studs: a chat TUI over an agent with
**bash**, **read**, **edit**, and **search** tools, driven by an Azure-hosted
model. No modes, no permission prompts, no configuration — you talk, it reads
and edits files and runs commands in your repo.

## Quickstart

Install (you need [Bun](https://bun.sh) and git), then set your Azure key in
the environment:

```
bun add --global @glrs-dev/glorious@next
export AZURE_OPENAI_API_KEY=…   # or AZURE_FOUNDRY_API_KEY / AZURE_API_KEY
export AZURE_RESOURCE_NAME=…     # your Azure AI Foundry resource
```

Start a session in any git repository:

```
glorious
```

`GLORIOUS_MODEL` overrides the default model (`gpt-5.6-luna`). Session history is
encrypted by default with a key in the macOS Keychain; set
`GLORIOUS_SESSION_ENCRYPTION=0` to disable it. Run `glorious --resume` to choose
an earlier session, or pass its ID directly.

:::details Keys

- Enter submits; Shift+Enter inserts a newline.
- Esc removes the newest queued message, then interrupts the running turn.
- Ctrl+C clears the composer; twice on an empty composer exits.
- Up/Down browse prompt history.
- Mouse-select copies to the clipboard.

:::
