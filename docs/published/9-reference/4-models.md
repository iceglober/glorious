---
title: models
---

# models

## precedence

highest first:

1. `--model provider/model-id`
2. `GLRS_MODEL`, `GLRS_VARIANT`
3. Project-User `.glrs/config.local.json`
4. Project `.glrs/config.json`
5. User `<user config>`/config.json`

there is no default. an unset model raises `No model configured.` paths and merge rules: [configuration](./14-configuration.md).

## the id

split on the first `/`. the provider half resolves through aliases, the model half is sent verbatim. no slash, a leading slash, or a trailing slash raises `Model must be "provider/model-id", got "X".`

aliases resolve before anything reads the id, so they work in `--model`, `GLRS_MODEL`, and config `model` alike. `doctor` and the status line report the canonical id.

| alias | canonical |
| --- | --- |
| `claude` | `anthropic` |
| `gemini`, `google-ai` | `google` |
| `vertex`, `google-vertex-ai` | `google-vertex` |
| `bedrock`, `aws` | `amazon-bedrock` |
| `azure-openai`, `azure-ai`, `foundry` | `azure` |
| `together`, `together-ai` | `togetherai` |
| `grok` | `xai` |
| `open-router` | `openrouter` |
 an unknown provider is an OpenAI-compatible endpoint and needs `providers.<id>.api`.

## per-provider settings

| provider | config keys | environment fallback |
| --- | --- | --- |
| `amazon-bedrock` | `api`, `region` | `AWS_REGION`, `AWS_DEFAULT_REGION`; region defaults to `us-east-1` |
| `google-vertex` | `api`, `project`, `location` | `GOOGLE_CLOUD_PROJECT` or `GOOGLE_VERTEX_PROJECT`, `GOOGLE_CLOUD_LOCATION` or `GOOGLE_VERTEX_LOCATION`; location defaults to `global` |
| everything else | `api` | |

config wins. a key a provider does not accept is dropped with a diagnostic. `glrs doctor` names the credential the selected provider wants.

## option objects

| key | where it goes |
| --- | --- |
| `factoryOptions` | the SDK provider factory; `fetch` is stripped, and a `baseURL` here wins over `api` |
| `requestOptions` | every model call; keys glrs owns are stripped with a diagnostic |
| `providerOptions` | merged over what `variant` produces |

`providers.<id>.models.<exact-model-id>` takes `requestOptions` and `providerOptions`; each merges over the provider's. `metadata` is model-level only.

both levels together:

```json
{
  "providers": {
    "openai": {
      "requestOptions": {
        "maxOutputTokens": 8000
      },
      "models": {
        "gpt-5.6": {
          "metadata": {
            "context": 400000
          }
        }
      }
    }
  }
}
```

## variant

reasoning effort. the accepted values are the model's own, published by
models.dev as `reasoning_options` and overridable with
`providers.<id>.models.<id>.metadata.variants`. across the catalogue they vary
widely: `low, medium, high` for many, `low, medium, high, xhigh, max` for some,
`none, high` for others, and no scale at all for most.

a value the model does not publish is dropped rather than sent: a provider that
rejects it fails the turn, and one that ignores it bills for effort nobody
chose. for providers that want a token budget instead of a word, the budget comes
from where the value sits in that model's own scale, so a three-level model and a
five-level model both reach the ceiling at their top.

one namespace is emitted per call.

| namespace | provider | payload |
| --- | --- | --- |
| `anthropic` | `anthropic`; `google-vertex` when the model id contains `claude` | `thinking.budgetTokens` |
| `google` | `google`; other `google-vertex` | `thinkingConfig.thinkingBudget` |
| `bedrock` | `amazon-bedrock` | `reasoningConfig.budgetTokens`, plus `maxReasoningEffort` for `low`, `medium`, `high` |
| `openai` | `openai`, `azure`, every other provider | `reasoningEffort` |

## metadata

context window and prices come from the models.dev catalogue (`https://models.dev/api.json`): one request at startup, 10 second timeout.

- cached to `$XDG_CACHE_HOME/glrs/models.dev.json`, else `~/.cache/glrs/models.dev.json`. the cache is read only when the fetch fails.
- configured `metadata` (`name`, `context`, `inputCost`, `outputCost`, `variants`) always wins over the catalogue.
- `GLRS_PRICE_MULTIPLIERS="provider=1.5,other=2"` scales catalogue prices. non-finite or negative is `1`.
- prices are per million tokens. failure is silent: the status line reads `unknown`.

see also: [connect a provider](../2-how-to/2-connect-a-provider.md), [configuration](./14-configuration.md)
