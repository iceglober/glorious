---
"@glrs-dev/glrs": minor
---

Standard providers, and endpoints that are not standard.

Fifteen providers now declare their own credentials in one table: Anthropic, OpenAI, Azure OpenAI / AI Foundry, Google Gemini, Google Vertex AI, Amazon Bedrock, OpenRouter, Groq, Mistral, DeepSeek, Cerebras, Cohere, xAI, Perplexity and Together AI. Only Azure did before; every other provider fell through to whatever variable its SDK happened to read, so glorious could not say what was missing and could not accept the second name a provider answers to.

**OpenAI-compatible endpoints now work at all.** An id glorious does not recognise is routed to an OpenAI-compatible client given a base URL — Ollama, LM Studio, vLLM, llama.cpp, a gateway, a company proxy. This previously threw `Provider ollama is not supported` no matter what was configured, because the compatible path was reachable only if models.dev happened to publish the provider, which no local server does.

```json
{ "model": "ollama/llama3.3", "providers": { "ollama": { "api": "http://localhost:11434/v1" } } }
```

`doctor` now names the provider and what is absent, rather than only the model:

```
model: groq/llama-3.3-70b
provider: Groq
missing: GROQ_API_KEY
```

The models.dev catalogue is cached to `~/.cache/glorious/models.dev.json`, so context windows and prices survive being offline instead of the status line falling back to `unknown` on the first flight without a network.

Adds `--model provider/model-id`, which takes precedence over everything but nothing else, and works alongside `-p` and `doctor` in any order. Two flag-parsing bugs fixed on the way: `doctor` was only recognised at argument zero, and a bare word anywhere was accepted rather than reported as the typo it is.

New: `docs/providers.md`.
