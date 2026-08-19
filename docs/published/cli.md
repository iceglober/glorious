---
title: CLI
---

# CLI

## Commands

```sh
glrs                      # open a session in the current git repo
glrs -p "<prompt>"        # one turn, headless: answer on stdout, tools on stderr
glrs --resume             # pick an earlier session
glrs --resume <id>        # reopen one directly
glrs doctor [--json]      # model, config diagnostics, and what would load
glrs --version            # print the version
glrs update               # update to the latest next release
glrs <subcommand>         # anything an extension added with g.cli
```

An extension can add subcommands of its own — `glrs wt list` and the like. They
run without opening a session, so they cost nothing to start and need no model
credentials. `glrs <unknown>` lists what is available. See
[extensions](/extensions).

## Environment

- `AZURE_FOUNDRY_API_KEY` / `AZURE_API_KEY` / `AZURE_OPENAI_API_KEY` — the model
  key. First one set wins.
- `AZURE_RESOURCE_NAME` — your Azure AI Foundry resource.
- `GLRS_MODEL` — model override, as `provider/model-id`; the default is `gpt-5.6-luna`.
- `GLRS_VARIANT` — reasoning effort, when the model advertises one.
- `GLRS_PRICE_MULTIPLIERS` — comma-separated provider price multipliers, such as `azure=1.1,openai=1`.
- `XDG_DATA_HOME` — where sessions live; defaults to `~/.local/share`.

## Sessions

Sessions are written to `$XDG_DATA_HOME/glrs/sessions` as plain JSON. Each
one records the whole conversation, so `--resume` replays the transcript and the
model keeps its context.

## Configuration

`.glrs/config.json` in the project, then `~/.config/glrs/config.json`.
Read-only; the environment variables above win over both.

```json
{ "model": "anthropic/claude-opus-5", "variant": "high" }
```
