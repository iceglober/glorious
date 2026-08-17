# Configuration

Configuration is read-only JSON. The nearest value wins, one key at a time.
The project file can select a model while personal configuration supplies the
provider settings it does not mention.

## Files

In order of precedence:

1. `.glorious/config.json` in the project
2. `~/.glorious/config.json`
3. `~/.config/glorious/config.json`

Environment variables and CLI flags override configuration files.

## Schema

```json
{
  "model": "provider/model-id",
  "variant": "high",
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
- `providers.<name>.api` — base URL for an OpenAI-compatible endpoint.
- `providers.<name>.region` — AWS Bedrock region.
- `providers.<name>.project` — Google Vertex project.
- `providers.<name>.location` — Google Vertex location.

Unknown keys are ignored. Invalid JSON is reported by `glorious doctor` and
ignored rather than preventing startup.

## Environment

- `GLORIOUS_MODEL` — model override.
- `GLORIOUS_VARIANT` — reasoning effort override.
- `GLORIOUS_PRICE_MULTIPLIERS` — comma-separated provider multipliers, such as `azure=1.1,openai=1`.
- `GLORIOUS_TOOL_TIMEOUT_MS` — overrides `tool_timeout_ms` for the current run.
- `XDG_DATA_HOME` — session storage root; defaults to `~/.local/share`.
- `XDG_CACHE_HOME` — model catalogue cache root; defaults to `~/.cache`.
- `NO_COLOR` — disable color when set.
- `TERM=dumb` — also disables color.

Provider credential and region variables are listed on the [providers](/providers)
page. Use `glorious doctor --json` to inspect model, provider, credentials, and
configuration diagnostics.
