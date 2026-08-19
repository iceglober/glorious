# Models

## Choosing a model

In order of precedence:

1. `--model provider/model-id` on the command line
2. `GLRS_MODEL` / `GLRS_VARIANT`
3. `.glrs/config.json` in the project
4. `~/.glrs/config.json`
5. `~/.config/glrs/config.json`
6. the default, `azure/gpt-5.6-luna`

```json
{
  "model": "anthropic/claude-opus-5",
  "variant": "high"
}
```

`model` is `provider/model-id`; a bare id means azure. `variant` is the
reasoning effort, when the model advertises one.

Merged nearest-first, one key at a time: a project may pin the model while your
personal config supplies the provider settings it does not mention. `~/.glrs/`
is read because that is already where your extensions and commands
live; `~/.config/glrs/` works too, for the XDG layout.

Config is read-only — nothing writes it at runtime. The core has no model
picker: edit the file or set the environment variable and restart, and
`--resume <id>` picks the session back up.

An extension can add one. `g.models()` returns the catalogue and
`g.setModel(label, variant)` switches for the next turn — see
`extensions.md`.

## Providers

Fifteen built in, plus any OpenAI-compatible endpoint. Which variable each one
reads, what else it needs, and how to point at a local server: `providers.md`.

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

At startup glrs asks [models.dev](https://models.dev) for one thing: the
context window and per-token pricing of the model you already selected. That is
what makes the status line's `ctx 12.3k(1%)` meaningful — a percentage needs a
denominator.

The answer is cached to `~/.cache/glrs/models.dev.json`, so after the first
successful fetch it works offline. Before that, or if the cache is gone and the
network is too, the status line reads `unknown` and everything else works.

`GLRS_PRICE_MULTIPLIERS=azure=1.1` scales the published rates when your
provider's pricing differs.

## When a turn dies

A connection lost before the model responds is retried three times and you never
see it. One lost mid-response cannot be retried — tokens are already on screen
and replaying would duplicate them — so it reports that the connection dropped
and stops. Send `continue`: the failed turn leaves a reminder of what it was
doing on the next one.

## Diagnostics

```sh
glrs doctor          # model and config diagnostics
glrs doctor --json
glrs --version
```
