---
title: CLI
---

# CLI

## Commands

```sh
glorious                      # open a session in the current git repo
glorious -p "<prompt>"        # one turn, headless: answer on stdout, tools on stderr
glorious --resume             # pick an earlier session
glorious --resume <id>        # reopen one directly
glorious doctor [--json]      # model and config diagnostics
glorious --version            # print the version
glorious update               # update to the latest next release
```

## Environment

- `AZURE_FOUNDRY_API_KEY` / `AZURE_API_KEY` / `AZURE_OPENAI_API_KEY` — the model
  key. First one set wins.
- `AZURE_RESOURCE_NAME` — your Azure AI Foundry resource.
- `GLORIOUS_MODEL` — model override, as `provider/model-id`; the default is `gpt-5.6-luna`.
- `GLORIOUS_VARIANT` — reasoning effort, when the model advertises one.
- `GLORIOUS_PRICE_MULTIPLIERS` — comma-separated provider price multipliers, such as `azure=1.1,openai=1`.
- `XDG_DATA_HOME` — where sessions live; defaults to `~/.local/share`.

## Sessions

Sessions are written to `$XDG_DATA_HOME/glorious/sessions` as plain JSON. Each
one records the whole conversation, so `--resume` replays the transcript and the
model keeps its context.

## Configuration

`.glorious/config.json` in the project, then `~/.config/glorious/config.json`.
Read-only; the environment variables above win over both.

```json
{ "model": "anthropic/claude-opus-5", "variant": "high" }
```
