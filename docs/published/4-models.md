---
title: models
---

# models

## choose one

highest precedence first:

1. cli: `--model provider/model-id`
2. `GLRS_MODEL` and `GLRS_VARIANT`
3. Project-User `.glrs/config.local.json`
4. Project `.glrs/config.json`
5. User `<User>/config.json`

```json
{
  "model": "anthropic/claude-opus-5",
  "variant": "high"
}
```

`model` must be `provider/model-id`. `variant` is reasoning effort when the
model supports it.

configure a model before starting with `--model`, `GLRS_MODEL`, or config. `/model`
opens the first-party picker and switches the next turn. it lists only providers
with environment, keychain, configured endpoint, or ambient cloud credentials;
Ctrl+A opens provider setup.

## providers

glrs includes fifteen providers and any OpenAI-compatible endpoint with a base
URL. credentials come from environment variables, ambient cloud auth, or the OS
credential store. see
[model providers](./3-providers.md).

```json
{
  "providers": {
    "amazon-bedrock": { "region": "eu-west-1" },
    "google-vertex": { "project": "my-project", "location": "europe-west4" },
    "ollama": { "factoryOptions": { "baseURL": "http://localhost:11434/v1" } }
  }
}
```

## prompt caching

glrs keeps the stable system prompt and conversation prefix reusable. OpenAI and
Azure Responses/Chat receive a stable per-session cache routing key; Anthropic
and Bedrock receive explicit message breakpoints; Google uses implicit caching.
Other provider SDKs receive no invented cache option when they expose no portable
control. Provider extensions own their cache behavior.

When a provider reports it, cache-read and cache-write usage is preserved as
telemetry rather than treating an unavailable measurement as zero.

## context and price

glrs asks [models.dev](https://models.dev) for the selected model's context
window, prices, and reasoning variants. it caches successful responses at:

```text
${XDG_CACHE_HOME:-~/.cache}/glrs/models.dev.json
```

without metadata the model still runs; context percentage and cost may be
unknown. exact entries under `providers.<provider>.models.<model-id>.metadata`
override models.dev. the same model entry can override standard request options
and provider-specific options; see [configuration](./5-customize/1-configuration.md).

provider pricing can be adjusted:

```sh
export GLRS_PRICE_MULTIPLIERS=azure=1.1,openai=1
```

## failed connections

a connection lost before output starts is attempted up to three times. a mid-response
disconnect cannot be retried without duplicating output; send `continue`.

## diagnostics

```sh
glrs doctor
glrs doctor --json
glrs --version
```
