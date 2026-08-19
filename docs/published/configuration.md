---
title: Configuration
---

# Configuration

Configuration is read-only JSON. The nearest value wins, one key at a time.
The project file can select a model while personal configuration supplies the
provider settings it does not mention.

## Files

In order of precedence:

1. `.glrs/config.local.json` in the project — the copy you do not commit
2. `.glrs/config.json` in the project
3. `~/.glrs/config.json`
4. `~/.config/glrs/config.json`

`.glorious/` is read everywhere `.glrs/` is, at lower precedence, so a project
or a machine set up before the rename keeps working with nothing to move. All
project paths still come before all personal ones whichever spelling each uses
— a project pinning a model in `.glorious/` beats your personal `.glrs/`. The
old name will stop being read in a future major version.

Environment variables and CLI flags override configuration files.

`config.local.json` is for the settings that are yours rather than the
project's — a different model, a local endpoint. Add it to `.gitignore` and it
layers over the committed file one key at a time, so it can change the model
without restating the provider settings.

## When it does not take effect

Every file above is optional, so a config that is never read looks exactly like
one that was never written. glrs says which is which, at startup and in
`glrs doctor`:

```
$ glrs doctor
model: azure/gpt-5.6-luna
provider: Azure OpenAI / AI Foundry
credentials: found
.glrs/config.json: "model" should be a string like "azure/gpt-5.6-sol", got object — ignored
~/.config/glrs/config.json: nothing here is a glrs setting (agent, permissions, mcp) — the whole file is ignored
```

Three things it will tell you about:

- **A key it knows, holding the wrong type.** `"model": {"selected": "…"}` is the common one — the value has to be a string. The key is recognised, so the wrong type used to be dropped exactly as silently as a typo.
- **A file where it recognised nothing at all.** Usually a config written for something else, or for an older glrs that had a nested `agent.llm` shape.
- **A file that is not valid JSON.**

Keys it does not recognise, in a file where it recognised something, stay
ignored and silent. A config that has grown a key glrs no longer knows
about is not a broken config.

## Schema

```json
{
  "model": "provider/model-id",
  "variant": "high",
  "steering_mode": "one-at-a-time",
  "follow_up_mode": "one-at-a-time",
  "extensions": { "load": ["web-fetch"], "disable": [] },
  "tools": { "disable": [] },
  "providers": {
    "openai-compatible": { "api": "http://localhost:11434/v1" },
    "amazon-bedrock": { "region": "us-east-1" },
    "google-vertex": { "project": "my-project", "location": "us-central1" }
  }
}
```

- `model` — model label as `provider/model-id`. A bare model id uses the default provider.
- `variant` — reasoning effort when the model advertises one.
- `tool_timeout_ms` — maximum time for a built-in shell/search tool, in milliseconds. Defaults to 600000.
- `steering_mode` — how many waiting `Alt+Enter` messages are delivered at each step boundary of the running turn. `"one-at-a-time"` (default) or `"all"`.
- `follow_up_mode` — how many waiting `Enter` messages become one turn. `"one-at-a-time"` (default) or `"all"`.
- `extensions.load` — shipped extensions to turn on, by name or by the package they ship as, plus paths (relative to this file, or absolute). `builtins` is on without being named; `web-fetch` and `ask-user` are not.
- `extensions.disable` — names that must not load, whichever layer asked for them. Beats `load`.
- `tools.disable` — tool names withheld from the model, whichever extension registered them.
- `providers.<name>.api` — base URL for an OpenAI-compatible endpoint.
- `providers.<name>.region` — AWS Bedrock region.
- `providers.<name>.project` — Google Vertex project.
- `providers.<name>.location` — Google Vertex location.

`one-at-a-time` is the default for both because it is the setting that lets the
model answer what you said before it reads what you said next. `all` is for
when the messages are one thought split across three Enters — it joins them
with a blank line and delivers them as a single message. See
[Using Glrs](./features.md#the-message-queue) for what the two kinds of message are.

Both are also read under their camelCase spellings, `steeringMode` and
`followUpMode`.

Unlike every other setting, the three lists **add up across all four files**
rather than the nearest one winning. They are sets, not values: a project
activating one extension must not switch off the one your personal config
activates everywhere. `disable` beats `load` from any layer.

Unknown keys are ignored. Invalid JSON is reported by `glrs doctor` and
ignored rather than preventing startup.

## Environment

- `GLRS_MODEL` — model override.
- `GLRS_VARIANT` — reasoning effort override.
- `GLRS_PRICE_MULTIPLIERS` — comma-separated provider multipliers, such as `azure=1.1,openai=1`.
- `GLRS_TOOL_TIMEOUT_MS` — overrides `tool_timeout_ms` for the current run.

Each is also read as `GLORIOUS_<name>`, at lower precedence, so a shell profile
written before the rename keeps working.
- `XDG_DATA_HOME` — session storage root; defaults to `~/.local/share`.
- `XDG_CACHE_HOME` — model catalogue cache root; defaults to `~/.cache`.
- `NO_COLOR` — disable color when set.
- `TERM=dumb` — also disables color.

Provider credential and region variables are listed on the [Model Providers](./providers.md)
page. Use `glrs doctor --json` to inspect model, provider, credentials, and
configuration diagnostics.
