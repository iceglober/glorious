---
title: model providers
---

# model providers

choose a provider with `provider/model-id` in `--model`, `GLRS_MODEL`, or config.
`glrs doctor` reports the selected provider and anything missing.

## built in

| provider | prefix | credentials | also needs |
| --- | --- | --- | --- |
| Anthropic | `anthropic` | `ANTHROPIC_API_KEY` | |
| OpenAI | `openai` | `OPENAI_API_KEY` | |
| Azure OpenAI / AI Foundry | `azure` | `AZURE_FOUNDRY_API_KEY`, `AZURE_API_KEY`, or `AZURE_OPENAI_API_KEY` | `AZURE_RESOURCE_NAME` |
| Google Gemini | `google` | `GOOGLE_GENERATIVE_AI_API_KEY` or `GEMINI_API_KEY` | |
| Google Vertex AI | `google-vertex` | application default credentials | project + location |
| Amazon Bedrock | `amazon-bedrock` | AWS credential chain | region |
| OpenRouter | `openrouter` | `OPENROUTER_API_KEY` | |
| Groq | `groq` | `GROQ_API_KEY` | |
| Mistral | `mistral` | `MISTRAL_API_KEY` | |
| DeepSeek | `deepseek` | `DEEPSEEK_API_KEY` | |
| Cerebras | `cerebras` | `CEREBRAS_API_KEY` | |
| Cohere | `cohere` | `COHERE_API_KEY` | |
| xAI | `xai` | `XAI_API_KEY` | |
| Perplexity | `perplexity` | `PERPLEXITY_API_KEY` | |
| Together AI | `togetherai` | `TOGETHER_AI_API_KEY` | |

accepted shorthands: `vertex`, `bedrock`, `aws`, `gemini`, `claude`, `foundry`,
`azure-openai`, `together`, `grok`, and `open-router`.

Azure accepts three key names because its portal, CLI, and SDK use different
names. the first one set wins.

## cloud settings

```json
{
  "providers": {
    "amazon-bedrock": { "region": "eu-west-1" },
    "google-vertex": { "project": "my-project", "location": "europe-west4" }
  }
}
```

Bedrock also reads `AWS_REGION`. Vertex also reads `GOOGLE_CLOUD_PROJECT` and
`GOOGLE_CLOUD_LOCATION`; config wins. Vertex uses application default
credentials, usually created with:

```sh
gcloud auth application-default login
```

## openai-compatible endpoints

an unknown provider prefix is treated as OpenAI-compatible and needs a base URL:

```json
{
  "model": "ollama/llama3.3",
  "providers": {
    "ollama": { "api": "http://localhost:11434/v1" }
  }
}
```

this covers Ollama, LM Studio, vLLM, llama.cpp, gateways, and company proxies.

## check it

```sh
glrs --model anthropic/claude-opus-5 doctor
glrs --model anthropic/claude-opus-5 doctor --json
```

credentials stay in the environment. glrs does not use a keychain or print
secret values.
