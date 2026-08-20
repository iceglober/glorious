---
title: configuration
---

# configuration

JSON files, hand-edited; unknown keys are ignored. every key is in the schema at `https://glrs.dev/config.schema.json`, which `$schema` points editors at. the `providers` block: [models](./2-models.md).

## files

| scope | path |
| --- | --- |
| Project-User | `<root>/.glrs/config.local.json` |
| Project | `<root>/.glrs/config.json` |
| User | `<user config>/config.json` |

a missing file is not an error. the User directory is the first of `$GLRS_CONFIG_HOME`, `$XDG_CONFIG_HOME/glrs`, `%APPDATA%/glrs` on Windows, `~/.config/glrs`. `LOCALAPPDATA` is not used.

in `extensions.load`, `~/` resolves against home and `./` or `../` against the directory of the file that named them. every other entry is a bare name.

```json
{
  "extensions": {
    "load": [
      "web-fetch",
      "./tools/reviewer.ts",
      "~/lab/tap.ts"
    ]
  }
}
```

## first run

in a git repository all three files are created, outside one only the User file. each new file holds `{"$schema": "https://glrs.dev/config.schema.json"}`; an existing file without `$schema` has it inserted in place. `.glrs/.gitignore` is created containing `/config.local.json`.

## merge

| keys | rule |
| --- | --- |
| `model`, `variant`, `toolTimeoutMs`, `steeringMode`, `followUpMode`, `agentConfigAllowlist` | nearest wins: Project-User, then Project, then User |
| `extensions.load`, `extensions.disable`, `tools.disable` | union of the three scopes, and disabled anywhere stays disabled |
| `providers` | JSON Merge Patch, deep; `null` deletes a key |

## agentConfigAllowlist

```json
{
  "agentConfigAllowlist": [
    "extensions"
  ]
}
```

`"extensions"` is the only section understood. it lets glrs write `<root>/.glrs/config.json`, never `config.local.json`, recording one extension as loaded or disabled. the write is a JSON round trip: comments and formatting do not survive. without the entry the write returns `not-allowed`.

## environment

| variable | effect |
| --- | --- |
| `GLRS_MODEL` | model, over config |
| `GLRS_VARIANT` | variant, over config |
| `GLRS_TOOL_TIMEOUT_MS` | tool timeout, over config; finite and above 0 |
| `GLRS_PRICE_MULTIPLIERS` | `provider=1.5,other=2`, scaling catalogue prices |

each name above has a `GLORIOUS_` fallback, read second. `GLRS_CONFIG_HOME` does not.

## diagnostics

reported in the transcript as `(config)`, on stderr as `[config]` under `-p`, and by `glrs doctor`.

| message | meaning |
| --- | --- |
| `<path>: not valid JSON, ignored` | the file was not parsed |
| `<path>: "model" should be a string like "azure/gpt-5.6-sol", got number, ignored` | wrong type, the key is dropped |
| `<path>: nothing here is a glrs setting (k1, k2, …), the whole file is ignored` | no known key in the file |
| `<path>: providers.X.requestOptions.model is owned by glrs, ignored` | glrs sets that call option itself |

## sessions

where they are stored, and what is in one: [sessions](./3-sessions.md).

see also: [turn things off](../2-how-to/8-turn-things-off.md), [models](./2-models.md)
