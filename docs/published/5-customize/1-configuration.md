---
title: configuration
---

# configuration

config is JSON in three scopes. the nearest value wins, one key at a time. a
model is required before glrs can run.

## scopes

| scope | path | purpose |
| --- | --- | --- |
| Project-User | `<project>/.glrs/config.local.json` | yours for this project; keep it gitignored |
| Project | `<project>/.glrs/config.json` | committed with the project |
| User | `<User>/config.json` | yours across every project |

`<User>` defaults to `~/.config/glrs` on macOS and Linux and `%APPDATA%\glrs`
on Windows.

resolution order for the User directory:

1. `GLRS_CONFIG_HOME`
2. `$XDG_CONFIG_HOME/glrs`
3. the platform default above

Project-User can change one setting without copying the rest of Project. Project
can choose a model while User supplies its provider settings. on its first run,
glrs creates User config. inside a Git repository, it also creates both project
config files and `.glrs/.gitignore` keeps `config.local.json` local. each config
gets the hosted schema link when missing; existing settings and formatting stay
in place.

older `~/.glrs`, `.glorious`, and `~/.config/glorious` paths are not read.

## editor autocomplete

add the hosted JSON Schema to any config file:

```json
{
  "$schema": "https://glrs.dev/config.schema.json"
}
```

editors that support JSON Schema use it for completion, descriptions, and
validation. `$schema` is metadata and does not affect runtime config.

## example

```json
{
  "$schema": "https://glrs.dev/config.schema.json",
  "model": "provider/model-id",
  "variant": "high",
  "reasoningDisplay": true,
  "toolTimeoutMs": 600000,
  "steeringMode": "one-at-a-time",
  "followUpMode": "one-at-a-time",
  "extensions": { "load": ["web-fetch"], "disable": [] },
  "tools": { "disable": [] },
  "providers": {
    "ollama": { "api": "http://localhost:11434/v1" },
    "amazon-bedrock": { "region": "us-east-1" },
    "google-vertex": { "project": "my-project", "location": "us-central1" }
  }
}
```

see [all configuration options](../../../docs-site/generated/4-reference/4-configuration-options.md) for types,
defaults, and descriptions generated from the schema.

## provider and model overrides

provider settings have three passthrough layers:

- `factoryOptions` goes directly to the installed AI SDK provider factory.
- `requestOptions` supplies standard AI SDK call options.
- `providerOptions` supplies the AI SDK's provider-namespaced call options.

an exact model id under `models` overrides the provider's request and provider
options. `metadata` overrides models.dev values:

```json
{
  "providers": {
    "openai": {
      "factoryOptions": {
        "baseURL": "https://proxy.example.com/v1",
        "headers": { "x-proxy-key": "..." }
      },
      "requestOptions": { "temperature": 0.2 },
      "providerOptions": { "openai": { "store": false } },
      "models": {
        "gpt-5": {
          "requestOptions": { "maxOutputTokens": 32000 },
          "providerOptions": { "openai": { "reasoningEffort": "high" } },
          "metadata": { "context": 400000 }
        }
      }
    }
  }
}
```

option objects merge recursively across scopes. arrays and scalar values replace
inherited values; `null` removes one. glrs passes unknown JSON-compatible options
through so new AI SDK options do not require a glrs release. model, messages,
tools, callbacks, wrapped fetch, and abort handling remain owned by glrs.

`extensions` may also be an array, shorthand for `extensions.load`.

provider-supplied reasoning is shown by default. set `reasoningDisplay` to
`false` to hide it, or to `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`
to show it only when the active model's configured `variant` is at least that
level.

both queue modes default to `one-at-a-time`.

extension and tool lists are sets: they add up across all three files.
`disable` wins over `load`. every other setting is nearest-wins.

## letting glrs write one answer

config is hand-edited by default. opt in when glrs may record whether a
first-party extension should load:

```json
{ "agentConfigAllowlist": ["extensions"] }
```

glrs then updates Project `.glrs/config.json`. it preserves other keys, but a
JSON rewrite does not preserve comments or formatting. restart after general
config changes; `/reload` applies extension and tool changes.

## environment

| variable | purpose |
| --- | --- |
| `GLRS_MODEL` | model override |
| `GLRS_VARIANT` | reasoning effort override |
| `GLRS_PRICE_MULTIPLIERS` | provider price multipliers, such as `azure=1.1` |
| `GLRS_TOOL_TIMEOUT_MS` | tool timeout for this run |
| `GLRS_CONFIG_HOME` | explicit User directory |
| `XDG_CONFIG_HOME` | config base when the explicit override is absent |
| `XDG_DATA_HOME` | session data base; default `~/.local/share` |
| `XDG_CACHE_HOME` | cache base; default `~/.cache` |
| `NO_COLOR` | disable color |
| `TERM=dumb` | disable color |

model, variant, price, and timeout variables also accept their legacy
`GLORIOUS_` names at lower precedence.

CLI flags and environment variables override files.

## diagnostics

```sh
glrs doctor
glrs doctor --json
```

missing files are fine. invalid JSON, recognized keys with the wrong type, and
files with no recognized settings are reported and ignored. unknown keys beside
a valid setting are ignored silently.
