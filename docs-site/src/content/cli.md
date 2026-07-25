# CLI reference

Matches `glorious --help`.

## `glorious`

Opens the interactive chat session. That is the whole command line.

- `--version` — print the version
- `--help` — usage

## Environment

- `AZURE_FOUNDRY_API_KEY` / `AZURE_API_KEY` / `AZURE_OPENAI_API_KEY` — the model key (required)
- `AZURE_RESOURCE_NAME` — the Azure AI Foundry resource
- `GLORIOUS_MODEL` — model override (default `gpt-5.6-luna`)
- `GLORIOUS_CONTEXT_SOFT_LIMIT` — optional request-context ceiling in tokens;
  old turns compact automatically at 75% of it
