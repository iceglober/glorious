---
title: configuration
---

# configuration

config is JSON in three scopes. the nearest value wins, one key at a time.

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
can choose a model while User supplies its provider settings.

older `~/.glrs`, `.glorious`, and `~/.config/glorious` paths are not read.

## example

```json
{
  "model": "provider/model-id",
  "variant": "high",
  "tool_timeout_ms": 600000,
  "steering_mode": "one-at-a-time",
  "follow_up_mode": "one-at-a-time",
  "extensions": { "load": ["web-fetch"], "disable": [] },
  "tools": { "disable": [] },
  "providers": {
    "ollama": { "api": "http://localhost:11434/v1" },
    "amazon-bedrock": { "region": "us-east-1" },
    "google-vertex": { "project": "my-project", "location": "us-central1" }
  }
}
```

| setting | value |
| --- | --- |
| `model` | `provider/model-id`; a bare ID uses Azure |
| `variant` | reasoning effort when the model supports it |
| `tool_timeout_ms` | built-in shell/search timeout in milliseconds |
| `steering_mode` | `one-at-a-time` or `all` |
| `follow_up_mode` | `one-at-a-time` or `all` |
| `extensions.load` | shipped extension names or paths |
| `extensions.disable` | extension names that must not load |
| `tools.disable` | tool names withheld from the model |
| `agentConfigAllowlist` | sections glrs may write; currently only `extensions` |
| `providers.<name>.api` | OpenAI-compatible base URL |
| `providers.<name>.region` | AWS Bedrock region |
| `providers.<name>.project` | Google Vertex project |
| `providers.<name>.location` | Google Vertex location |

`extensions` may also be an array, shorthand for `extensions.load`.

`steeringMode` and `followUpMode` are accepted aliases. both queue modes default
to `one-at-a-time`.

extension and tool lists are sets: they add up across all three files.
`disable` wins over `load`. every other setting is nearest-wins.

## letting glrs write one answer

config is hand-edited by default. opt in when glrs may record whether a shipped
extension should load:

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
