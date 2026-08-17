# Models and configuration

## Choosing a model

In order of precedence:

1. `GLORIOUS_MODEL` / `GLORIOUS_VARIANT`
2. `.glorious/config.json` in the project
3. `~/.config/glorious/config.json`
4. the default, `azure/gpt-5.6-luna`

```json
{
  "model": "anthropic/claude-opus-5",
  "variant": "high"
}
```

`model` is `provider/model-id`; a bare id means azure. `variant` is the
reasoning effort, when the model advertises one.

Config is read-only — nothing writes it at runtime. The core has no model
picker: edit the file or set the environment variable and restart, and
`--resume <id>` picks the session back up.

An extension can add one. `g.models()` returns the catalogue and
`g.setModel(label, variant)` switches for the next turn — see
`extensions.md`.

## Providers

`amazon-bedrock`, `anthropic`, `azure`, `cerebras`, `cohere`, `deepseek`,
`google`, `google-vertex`, `groq`, `mistral`, `openai`, `openrouter`,
`perplexity`, `togetherai`, `xai`, and any OpenAI-compatible endpoint.

Credentials come from the environment. Each provider's SDK reads its own
standard variable; azure is special-cased because it answers to three
(`AZURE_FOUNDRY_API_KEY`, `AZURE_API_KEY`, `AZURE_OPENAI_API_KEY`, in that
order) and also needs `AZURE_RESOURCE_NAME`.

Nothing is stored in a keychain. Nothing prompts for a key.

Per-provider settings, when a provider needs them:

```json
{
  "providers": {
    "amazon-bedrock": { "region": "eu-west-1" },
    "google-vertex": { "project": "my-project", "location": "europe-west4" },
    "my-endpoint": { "api": "https://example.com/v1" }
  }
}
```

## Cost and context

At startup glorious asks [models.dev](https://models.dev) for one thing: the
context window and per-token pricing of the model you already selected. That is
what makes the status line's `ctx 12.3k(1%)` meaningful — a percentage needs a
denominator. It is one request, and it fails silently: offline, the status line
reads `unknown` and everything else works.

`GLORIOUS_PRICE_MULTIPLIERS=azure=1.1` scales the published rates when your
provider's pricing differs.

## When a turn dies

A connection lost before the model responds is retried three times and you never
see it. One lost mid-response cannot be retried — tokens are already on screen
and replaying would duplicate them — so it reports that the connection dropped
and stops. Send `continue`: the failed turn leaves a reminder of what it was
doing on the next one.

## Diagnostics

```sh
glorious doctor          # model and config diagnostics
glorious doctor --json
glorious --version
```
