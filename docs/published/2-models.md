---
title: models and providers
---

# models and providers

there is no default model and no default provider. a run with neither set stops
before it opens a session:

```text
No model configured. Set GLRS_MODEL="provider/model-id" or add "model" to glrs config.
```

this was once a fallback to `azure/gpt-5.6-luna`, and a model id naming no
provider meant azure, so the most likely provider in any run was the one nobody
chose, on the single code path that dropped `providers.azure.api` and sent a
private gateway's traffic to the public endpoint. the guess and the
misconfiguration compounded. both are gone.

## choosing one

highest precedence first:

1. `--model provider/model-id`, which sets `GLRS_MODEL` in the process before
   anything reads a model, so it wins exactly the way the variable does, in the
   TUI and under `-p` alike.
2. `GLRS_MODEL`, then `GLORIOUS_MODEL`.
3. the merged config `model`: Project-User, then Project, then User; nearest wins.

`variant` resolves on its own chain: `GLRS_VARIANT`, `GLORIOUS_VARIANT`, then
config `variant`.

```json
{
  "model": "anthropic/claude-opus-5",
  "variant": "high"
}
```

the core has no model picker. an extension can change the model for the next
turn with `g.setModel()`.

## `provider/model-id`

the value is split on the **first** slash. a leading slash, a trailing slash, or
no slash at all is rejected with `Model must be "provider/model-id", got "x".`
everything after the first slash stays with the model id, so
`openrouter/anthropic/claude-x` is provider `openrouter` asking for model
`anthropic/claude-x`.

## the fifteen providers

each provider's own SDK would find its credential unaided. glrs keeps this table
anyway, so it can say *why* a session will not start, and so it can accept the
second and third names a provider answers to. variables are tried in the order
listed; the first one set wins.

| provider | id | credential variables | also needs |
| --- | --- | --- | --- |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | |
| OpenAI | `openai` | `OPENAI_API_KEY` | |
| Azure OpenAI / AI Foundry | `azure` | `AZURE_FOUNDRY_API_KEY` or `AZURE_API_KEY` or `AZURE_OPENAI_API_KEY` | `AZURE_RESOURCE_NAME` |
| Google Gemini | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` | |
| Google Vertex AI | `google-vertex` | `GOOGLE_APPLICATION_CREDENTIALS` | `GOOGLE_CLOUD_PROJECT` or `providers.google-vertex.project` |
| Amazon Bedrock | `amazon-bedrock` | `AWS_ACCESS_KEY_ID` or `AWS_PROFILE` or `AWS_BEARER_TOKEN_BEDROCK` | `AWS_REGION` or `providers.amazon-bedrock.region` |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | |
| Groq | `groq` | `GROQ_API_KEY` | |
| Mistral | `mistral` | `MISTRAL_API_KEY` | |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` | |
| Cohere | `cohere` | `COHERE_API_KEY` | |
| xAI | `xai` | `XAI_API_KEY` | |
| Perplexity | `perplexity` | `PERPLEXITY_API_KEY` | |
| Together AI | `togetherai` | `TOGETHER_AI_API_KEY` | |

Azure answers to three names because Foundry and OpenAI-on-Azure are the same
deployment surface, and between the portal, the CLI and the SDK all three are in
the wild. Vertex authenticates with application default credentials rather than
a key, `gcloud auth application-default login` is usually enough. Bedrock uses
the standard AWS credential chain, so an assumed role or an SSO profile works.

there is no `glrs login` and no credential store of glrs's own: what is in the
environment is what it uses. a key written into config as
`factoryOptions.apiKey` works as well, and `glrs doctor --json` prints the
resolved model settings exactly as they are, so config is the wrong place for a
secret you would not paste into a terminal.

## provider aliases

the canonical ids follow the SDK package names, which is why Vertex is
`google-vertex` and Bedrock is `amazon-bedrock`, reasonable as identifiers, not
what anyone reaches for. an alias resolves before anything else sees the id, so
these work in `--model`, in `GLRS_MODEL`, and in the config `model` alike:

| you type | you get |
| --- | --- |
| `claude` | `anthropic` |
| `gemini`, `google-ai` | `google` |
| `vertex`, `google-vertex-ai` | `google-vertex` |
| `bedrock`, `aws` | `amazon-bedrock` |
| `azure-openai`, `azure-ai`, `foundry` | `azure` |
| `together`, `together-ai` | `togetherai` |
| `grok` | `xai` |
| `open-router` | `openrouter` |

the alias is resolved, not remembered: `doctor` and the status line report
`amazon-bedrock` however you spelled it. a `providers` block is the one place an
alias does not reach, it is keyed by the canonical id, so a
`providers.bedrock.region` beside a working `"model": "bedrock/…"` is reported
unused and dropped.

## what each provider reads from config

every provider reads `providers.<id>.api`, the base URL. `region` is read by
`amazon-bedrock` only; `project` and `location` by `google-vertex` only. one of
these set where it is not read is dropped and reported,
`providers.openai.region is not used by openai, ignored`, rather than being
carried to a factory that would ignore it in silence.

```json
{
  "providers": {
    "amazon-bedrock": { "region": "eu-west-1" },
    "google-vertex": { "project": "my-project", "location": "europe-west4" }
  }
}
```

config wins over the environment for both. bedrock otherwise reads `AWS_REGION`,
then `AWS_DEFAULT_REGION`, then falls back to `us-east-1`. vertex reads
`GOOGLE_CLOUD_PROJECT` then `GOOGLE_VERTEX_PROJECT` for the project, and
`GOOGLE_CLOUD_LOCATION` then `GOOGLE_VERTEX_LOCATION` for the location, which
falls back to `global`.

## openai-compatible endpoints

any provider id glrs does not know is reached through the OpenAI-compatible
client. it needs a base URL, because there is nothing else to guess from:

```json
{
  "model": "ollama/llama3.3",
  "providers": {
    "ollama": { "api": "http://localhost:11434/v1" }
  }
}
```

that covers Ollama, LM Studio, vLLM, llama.cpp, gateways and company proxies.
without a base URL the run ends with

```text
ollama is not a built-in provider. Give it a base URL to use it as an OpenAI-compatible endpoint: {"providers":{"ollama":{"api":"…"}}}
```

unless the id is a near miss of one that ships, in which case it says so
instead, `Unknown provider "openai2", did you mean "openai"?`, because an id
one character off a real one is a typo far more often than it is a local server.

## factoryOptions, requestOptions, providerOptions

three seams, at three moments in the call:

| key | reaches | typical contents |
| --- | --- | --- |
| `factoryOptions` | the SDK provider factory, at construction | `baseURL`, `apiKey`, `headers`, `resourceName`, `apiVersion` |
| `requestOptions` | every model call | `temperature`, `maxOutputTokens`, `topP`, `seed`, `maxRetries`, `timeout`, `headers` |
| `providerOptions` | the call's provider namespace | anything that provider reads under `openai`, `anthropic`, `google`, `bedrock` |

`requestOptions` and `providerOptions` may also be set per model, under
`providers.<id>.models.<model-id>`, where the per-model object is merged over the
provider-level one, nested objects key by key, anything else replaced.
`factoryOptions` is provider-level only: the factory is built once per provider,
so one written under a model id is read by nothing, and nothing says so.

`providerOptions` is merged over what glrs computed for the call, so it is the
override of last resort, including for reasoning shape, if `variant` is not the
control you want. `factoryOptions.apiKey` beats the environment; a
`factoryOptions.baseURL` beats `api`.

two things cannot be handed over. `factoryOptions.fetch` is deleted and reported
`is owned by glrs, ignored`: the wrapped fetch carries the request deadlines and
the `before_provider_request` / `after_provider_response` hooks, and a
replacement would take both away without saying so. and forty-five `requestOptions`
keys that name the agent's own job, `model`, `messages`, `tools`, `stopWhen`,
`prepareStep`, `providerOptions`, every `on*` callback, are stripped the same
way, each with its own line.

## variant

`variant` is reasoning effort, and it is spelled four ways only: `minimal`,
`low`, `medium`, `high`. anything else is dropped without a word, and the model
runs at the provider's own default.

reasoning effort is not one setting with one spelling, so the word is translated
per provider. the token budgets are glrs's reading of what each word should buy,
the words are the interface, and this is the one place they become numbers:

| namespace | emitted | minimal | low | medium | high |
| --- | --- | --- | --- | --- | --- |
| `openai` | `reasoningEffort` | `"minimal"` | `"low"` | `"medium"` | `"high"` |
| `anthropic` | `thinking.budgetTokens` | 1024 | 4096 | 12288 | 24576 |
| `google` | `thinkingConfig.thinkingBudget` | 1024 | 4096 | 12288 | 24576 |
| `bedrock` | `reasoningConfig.budgetTokens` | 1024 | 4096 | 12288 | 24576 |

which namespace a provider gets: `azure` reads `openai`'s, because it is served
by the openai SDK. `google-vertex` reads `anthropic`'s when the model id contains
"claude" and `google`'s otherwise, the namespace follows the model, not the
host. `amazon-bedrock` reads `bedrock`. everything glrs does not know is reached
through the OpenAI-compatible client, so it reads `openai`. bedrock also takes
the word alongside the number as `maxReasoningEffort`, except for `minimal`,
which it has no spelling for.

on the openai path two more options are always sent. one is
`textVerbosity: "low"`. the other, `store: false`, matters more than it looks: left
unset, the provider keeps reasoning server-side and replays it as
`{type:"item_reference", id:"rs_…"}`, and the turn then dies with `Item with id
'rs_…' not found` whenever that lookup misses. glrs sends its whole history every
turn and gains nothing from server-side state, and `false` is what makes the
provider return `reasoning.encrypted_content`, which is what keeps reasoning
replayable at all.

## prompt caching

openai and google cache a prompt prefix without being asked; on the openai path
glrs adds a `promptCacheKey` derived from the project root and session id, so one
conversation routes consistently.

anthropic and bedrock cache only what is explicitly marked. the mark goes on the
**second-to-last** message: everything up to and including it is cached, and it
is the newest point that will still be there next turn. the breakpoint therefore
advances each turn, which is deliberate, these providers match on prefix, so a
longer prefix beginning with the cached one extends the hit rather than starting
over. a conversation shorter than two messages has no stable prefix and is not
marked.

## context window and price

glrs asks [models.dev](https://models.dev) for the selected model's context
window, prices and reasoning variants: one request at startup, ten-second
timeout. a successful response is written to

```text
${XDG_CACHE_HOME:-~/.cache}/glrs/models.dev.json
```

and read from there when the fetch fails. failure is silent, a catalogue that
cannot be reached costs pricing and context size, not the session. offline with a
cold cache there is no denominator, so the status line reads `ctx 12.3k(unknown)`
and everything else works.

anything set under `providers.<id>.models.<model-id>.metadata`, `name`,
`context`, `inputCost`, `outputCost`, `variants`, wins over the catalogue, which
is how a model the catalogue has never heard of gets a context percentage.

prices can be scaled per provider, for a negotiated rate or a reseller's margin:

```sh
export GLRS_PRICE_MULTIPLIERS=azure=1.1,openai=1
```

## when the context fills

once the provider reports the conversation past 75% of the window, glrs compacts
it without being asked: the older part is summarised by a separate model call
with no tools, and the tail is kept. the cut lands on the newest user message
that still leaves 20 000 tokens of tail behind it, weighed at roughly four
characters to a token, good enough to choose a cut point, since the provider's
own count is what decided to cut at all. it has to be a user message: a tool
result separated from the call it answers is an invalid request. the summary
replaces everything before it and the turn continues, and only one compaction
runs per growth phase, so one that freed little does not run again immediately.

a window glrs does not know is a percentage it cannot compute. with no catalogue
entry and no configured `context`, nothing compacts on its own.

`/compact` does the same thing on demand and takes an optional instruction for
the summary. asked for by hand it compacts whatever is there rather than
declining because the 20 000 could not be found. under `-p` nothing compacts:
a headless run starts a fresh session and has no earlier conversation to fold.

## when a call fails

three mechanisms, at three layers.

`maxRetries: 5` goes to the AI SDK, which handles what it recognises as
retryable. it is a plain `requestOptions` key, so a config can lower it.

underneath, each HTTP request runs against a deadline and is retried on a
connection failure, with deadlines of 30, 10 and 10 minutes. retryable means a
timeout or one of `ECONNRESET`, `ECONNREFUSED`, `ECONNABORTED`, `EPIPE`,
`ETIMEDOUT`, `EHOSTUNREACH`, `ENETUNREACH`, `ENETDOWN`, `EAI_AGAIN`. `ENOTFOUND`
is deliberately absent, a hostname that does not exist will not start existing
on the third attempt.

above both, a stream that dies mid-response is re-sent up to three times, for
four attempts in total. that is only safe while the attempt is unobservable:
nothing written, nothing thought aloud, no tool run. once anything has been
produced, re-sending would duplicate it, so the failure surfaces instead and the
next turn opens with a reminder naming what the last one was answering and how it
failed.

## glrs doctor

```sh
glrs doctor
glrs doctor --json
```

`doctor` resolves what would run without running any of it, extensions are
listed, never loaded, because a diagnostic that executes programs is not a
diagnostic. with nothing configured:

```text
model: not configured
  No model configured. Set GLRS_MODEL="provider/model-id" or add "model" to glrs config.
providers: anthropic, openai, azure, google, google-vertex, amazon-bedrock, openrouter, groq, mistral, deepseek, cerebras, cohere, xai, perplexity, togetherai
extensions: builtins (bundled)
```

with a model set, and its credentials absent:

```text
model: amazon-bedrock/anthropic.claude-opus-4
provider: Amazon Bedrock
missing: AWS_ACCESS_KEY_ID or AWS_PROFILE or AWS_BEARER_TOKEN_BEDROCK
missing: AWS_REGION or providers.amazon-bedrock.region
  Uses the standard AWS credential chain, so an assumed role or SSO profile works.
extensions: builtins (bundled)
```

`model` is the resolved id, after aliases. `provider` is the label from the
table, or `<id> (OpenAI-compatible)` for an id glrs does not know. each `missing`
line names one thing to set, a list of variables joined by `or` means any one of
them will do. `credentials: found` replaces them all when nothing is missing, and
means the variables are present, not that the key is valid, a key configured as
`factoryOptions.apiKey` is not counted, and doctor names the variable anyway.
config diagnostics follow at the end. they are not a `doctor` feature, the TUI
prints them at startup and `-p` writes them to stderr, because doctor is the
command you run once you already suspect something, and a silent config gives
you nothing to suspect. [configuration](./6-configuration.md) has the full set.

`doctor` accepts `--json` and nothing else, so `--model` cannot be handed to it,
[command line](./5-cli.md) has the parsing rule behind that. to ask about a
model you have not configured, set the variable for the one command:

```sh
GLRS_MODEL=anthropic/claude-opus-5 glrs doctor
```

with a model resolving and its credentials in place, the next thing is the
screen it opens: [the session](./3-session.md).
