---
title: models
---

# models

## precedence

highest first:

1. `/model`, for the rest of the session
2. `--model provider/model-id`
3. `GLRS_MODEL`, `GLRS_VARIANT`
4. Project-User `.glrs/config.local.json`
5. Project `.glrs/config.json`
6. User `<user config>/config.json`

there is no default. paths and merge rules: [configuration](./14-configuration.md).

## nothing set

the TUI opens anyway, and `/model` picks one:

```
glrs
? Choose model  7243/7243
  search: ▏
› anthropic/claude-opus-5
  anthropic/claude-sonnet-5
```

the picker is the `model-picker` extension, which loads by default. it opens
itself when nothing is set. `esc` cancels, and the status line then reads
`no model`; pressing `enter` on a message answers
`(no model chosen: /model picks one)` and leaves what you typed in the composer.

with `model-picker` disabled the message names the config instead. either way
nothing is sent to a provider until a model exists.

`-p` is the exception. a pipeline has nowhere to ask, so it still exits with
`No model configured.` before anything runs:

```bash
glrs -p "what failed?"     → No model configured. Set GLRS_MODEL="provider/model-id" …
```

## keeping the choice

`/model` writes `model` and `variant` into `<project root>/.glrs/config.json`
when `agentConfigAllowlist` names `model`:

```json
{
  "agentConfigAllowlist": [
    "model"
  ]
}
```

without it the choice lasts the session and `/model` prints the line to paste.
picking the default reasoning effort removes `variant` rather than writing null.
for every project, put `model` in the User config by hand:
[configuration](./14-configuration.md).

## a provider with no credentials

choosing one always succeeds. the row says what is absent, the switch happens,
and the turn is still sent:

```
› openrouter/~anthropic/claude-opus-latest  needs OPENROUTER_API_KEY
```

```
Model switched to openrouter/~anthropic/claude-opus-latest.
openrouter: glrs cannot see OPENROUTER_API_KEY. Turns are still sent, and the
provider decides.
```

glrs reads the environment and config and nothing else, so an empty list is not
a promise that a call will succeed and a full one is not proof it will fail.
Bedrock through an SSO profile, Vertex through application default credentials,
and any provider an extension registers all report a gap and all work. the
provider's own refusal is the authority, so glrs warns and does not block.

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
| `azure` | `api` | `AZURE_RESOURCE_NAME` is required alongside the key |
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
| `azure` | `azure` | `reasoningEffort`; DeepSeek deployments route through chat |
| `openai` | `openai`, and every other provider | `reasoningEffort` |

## metadata

context window and prices come from the models.dev catalogue (`https://models.dev/api.json`): one request at startup, 10 second timeout.

- cached to `$XDG_CACHE_HOME/glrs/models.dev.json`, else `~/.cache/glrs/models.dev.json`. the cache is read only when the fetch fails.
- configured `metadata` (`name`, `context`, `inputCost`, `outputCost`, `variants`) always wins over the catalogue.
- `GLRS_PRICE_MULTIPLIERS="provider=1.5,other=2"` scales catalogue prices. non-finite or negative is `1`.
- prices are per million tokens. failure is silent: the status line reads `unknown`.

## tiers

a tier is a name for the model you want for a kind of work, and a list of
candidates in preference order. the first one glrs has credentials for wins.

```json
{
  "extensions": {
    "settings": {
      "tiers": {
        "default": "balanced",
        "fast": ["anthropic/claude-haiku-4-5", "openai/gpt-5.6-mini"],
        "balanced": ["anthropic/claude-opus-5", "azure/gpt-5.6-sol"],
        "deep": [{ "model": "anthropic/claude-opus-5", "variant": "high" }]
      }
    }
  }
}
```

```
/tier              list them, and what each resolves to
/tier deep         switch
```

```
  fast                azure/gpt-5.6-luna
› balanced (default)  azure/gpt-5.6-luna
  deep                nothing reachable
```

glrs ships no tiers and no opinion about which model belongs in which. a table
saying `medium = opus-5` is wrong the month a new model lands. the names are
yours, so they need not avoid `low`, `medium` and `high`, which mean reasoning
effort everywhere else ([variant](#variant)).

`default` names the tier used when a session opens with no model. it resolves
before the picker opens, so the ordinary path is that you never see the picker.
`-p` is not covered: it resolves its model before extensions load, so a
pipeline still needs `GLRS_MODEL` or `model` in config.

a lone string is a tier of one. anything that is not `provider/model-id` is
dropped rather than guessed at, and a tier left with nothing usable does not
appear.

## provider warnings

the model answers, but the provider dropped something on the way. reported in
the transcript as `(provider warning)`, on stderr as `[provider]` under `-p`:

```
(provider warning) azure.responses/gpt-5.6-luna: topK is not supported
```

said once per provider, model and first sentence, for the life of the process.
these arrive once per model call, so the second copy is dropped rather than
repeated. the text is clipped to 160 characters: the SDK embeds whatever it is
complaining about, and for `Non-OpenAI reasoning parts are not supported` that
is the whole reasoning block.

glrs does not act on them. a warning is not a failed turn, and a turn that
failed says so on its own.

see also: [connect a provider](../2-how-to/2-connect-a-provider.md), [configuration](./14-configuration.md)
