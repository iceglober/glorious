---
title: providers
---

# providers

choose a provider with `provider/model-id` in `--model`, `GLRS_MODEL`, or config.
`glrs doctor` reports the selected provider and anything missing. see
[all providers](../../docs-site/generated/4-reference/5-all-providers.md) for built-in prefixes, credentials,
and aliases.

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

Bedrock reads `AWS_REGION` or `AWS_DEFAULT_REGION`; runtime falls back to
`us-east-1`. Vertex reads `GOOGLE_CLOUD_PROJECT` or `GOOGLE_VERTEX_PROJECT`, and
`GOOGLE_CLOUD_LOCATION` or `GOOGLE_VERTEX_LOCATION`; location defaults to
`global`. config wins. Vertex uses application default credentials, usually
created with:

```sh
gcloud auth application-default login
```

## openai-compatible endpoints

an unknown provider prefix is treated as OpenAI-compatible and needs a base URL:

```json
{
  "model": "ollama/llama3.3",
  "providers": {
    "ollama": { "factoryOptions": { "baseURL": "http://localhost:11434/v1" } }
  }
}
```

this covers Ollama, LM Studio, vLLM, llama.cpp, gateways, and company proxies.
`factoryOptions` is passed directly to the AI SDK provider; built-in providers
can use it for provider-specific endpoints, headers, and other SDK settings.

## check it

```sh
glrs --model anthropic/claude-opus-5 doctor
glrs --model anthropic/claude-opus-5 doctor --json
```

credentials can stay in the environment. in the TUI, `/model` then Ctrl+A stores
an API key in the operating-system credential store; config records only a
non-secret `"credential": "keychain"` marker. keys are read lazily for the
selected provider and cached for the process, so glrs does not enumerate the
keychain or repeatedly trigger an operating-system prompt. macOS Keychain,
Windows Credential Manager, and Linux Secret Service are supported; when a
secure store is unavailable, use an environment variable.

`doctor` recognizes the credential variables listed in the table; an SDK
credential source outside that list may still work after a warning.
