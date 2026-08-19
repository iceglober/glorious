---
title: cli
---

# cli

## commands

| command | action |
| --- | --- |
| `glrs` | start a new TUI session |
| `glrs -p "<prompt>"` / `glrs --print "<prompt>"` | run one headless turn |
| `cat log \| glrs -p "what failed?"` | add piped input to the prompt |
| `glrs --resume` | choose a session to resume |
| `glrs --resume <id>` | resume one session |
| `glrs --model provider/model` | choose a model for this run |
| `glrs doctor [--json]` | inspect model, credentials, config, and extensions |
| `glrs --version` | print the installed version |
| `glrs update` | install the newest `next` release |

in print mode, assistant text goes to stdout and tool activity goes to stderr.
extensions can register additional `--name value` flags.

## environment

| variable | purpose |
| --- | --- |
| `GLRS_MODEL` | `provider/model-id` override |
| `GLRS_VARIANT` | reasoning effort |
| `GLRS_PRICE_MULTIPLIERS` | provider price adjustments |
| `GLRS_TOOL_TIMEOUT_MS` | built-in tool timeout in milliseconds |
| `GLRS_CONFIG_HOME` | explicit User directory |
| `XDG_CONFIG_HOME` | config base |
| `XDG_DATA_HOME` | session data base |
| `XDG_CACHE_HOME` | model metadata cache base |
| `NO_COLOR` | disable color |

provider credential variables are listed under [model providers](./providers.md).

## config precedence

```text
CLI > environment > Project-User > Project > User > defaults
```

see [configuration](./3-configuration.md) for paths and schema.

## exit status

`glrs -p` returns a non-zero status when the turn fails. interactive sessions
report errors in the transcript and remain open.
