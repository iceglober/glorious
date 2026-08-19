---
title: Model Providers
---

# Model Providers

Fifteen providers glrs knows without being told, plus any endpoint that
speaks the OpenAI API.

Pick one with `--model provider/model-id`, `GLRS_MODEL`, or `model` in
config. `glrs doctor` names the provider and anything missing.

## Built in

| Provider | `provider/` | Credentials | Also needs |
| --- | --- | --- | --- |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | |
| OpenAI | `openai` | `OPENAI_API_KEY` | |
| Azure OpenAI / AI Foundry | `azure` | `AZURE_FOUNDRY_API_KEY`, `AZURE_API_KEY` or `AZURE_OPENAI_API_KEY` | `AZURE_RESOURCE_NAME` |
| Google Gemini | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` | |
| Google Vertex AI | `google-vertex` | Application Default Credentials | project + location |
| Amazon Bedrock | `amazon-bedrock` | the AWS credential chain | region |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | |
| Groq | `groq` | `GROQ_API_KEY` | |
| Mistral | `mistral` | `MISTRAL_API_KEY` | |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` | |
| Cohere | `cohere` | `COHERE_API_KEY` | |
| xAI | `xai` | `XAI_API_KEY` | |
| Perplexity | `perplexity` | `PERPLEXITY_API_KEY` | |
| Together AI | `togetherai` | `TOGETHER_AI_API_KEY` | |

Shorthands resolve: `vertex`, `bedrock`, `aws`, `gemini`, `claude`, `foundry`,
`azure-openai`, `together`, `grok`, `open-router`. A name close to a built-in one
is named rather than treated as an unknown endpoint — `--model vertexai/x` asks
whether you meant `google-vertex`.

Azure accepts three names because the portal, the CLI and the SDK each use a
different one, and the SDK reads only its own — a key sitting in the environment
under the wrong name used to fail a session with no explanation.

Provider settings can sit in Project-User `.glrs/config.local.json`, Project
`.glrs/config.json`, or User `config.json` — merged nearest-first, so a project
overrides one key without restating the rest. User defaults to
`~/.config/glrs/config.json` on macOS and Linux and
`%APPDATA%\glrs\config.json` on Windows.

## Anything else

An id glrs does not recognise is treated as an OpenAI-compatible endpoint.
It needs a base URL, which is the one thing that cannot be guessed:

```json
{
  "model": "ollama/llama3.3",
  "providers": { "ollama": { "api": "http://localhost:11434/v1" } }
}
```

That covers Ollama, LM Studio, vLLM, llama.cpp, a gateway, or a company proxy.
Set the key in the provider's usual variable if it wants one.

## Cloud providers

```json
{
  "providers": {
    "amazon-bedrock": { "region": "eu-west-1" },
    "google-vertex": { "project": "my-project", "location": "europe-west4" }
  }
}
```

Both also read the standard environment variables — `AWS_REGION`,
`GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION` — and config wins. Bedrock uses
the ordinary AWS credential chain, so an assumed role or an SSO profile works.
Vertex authenticates with ADC; `gcloud auth application-default login` is
usually enough.

## Models and prices

Model metadata — context window, per-token prices, reasoning levels — comes from
[models.dev](https://models.dev) at startup, and is cached to
`~/.cache/glrs/models.dev.json`. After the first successful fetch it works
offline; you keep the context percentage and cost, refreshed whenever a fetch
succeeds.

`GLRS_PRICE_MULTIPLIERS=azure=1.1` scales the published rates when your
contract differs.

## Checking it

```sh
$ glrs --model anthropic/claude-opus-5 doctor
model: anthropic/claude-opus-5
provider: Anthropic
missing: ANTHROPIC_API_KEY
```

## Switching at runtime

The core has no picker. `g.models()` and `g.setModel()` are on the extension
API, so one is about twenty lines — see `extensions.md`.
