---
title: connect a provider
---

# connect a provider

each provider reads environment credentials. `/model`, then Ctrl+A, can store an
API key in the operating-system credential store. the full list of providers,
aliases and environment variables:
[models](../9-reference/4-models.md).

## api key

```bash
export ANTHROPIC_API_KEY=sk-…
GLRS_MODEL=anthropic/claude-opus-5 glrs doctor
```

with the key exported and no model set anywhere, `glrs` still starts: the picker
opens with the Anthropic models. the same models appear after adding Anthropic
through Ctrl+A.

## azure

`AZURE_FOUNDRY_API_KEY`, `AZURE_API_KEY`, or `AZURE_OPENAI_API_KEY`; the first one set wins.
`AZURE_RESOURCE_NAME` is also required.

## bedrock and vertex

Bedrock reads the standard AWS credential chain: `AWS_ACCESS_KEY_ID`, `AWS_PROFILE`, or
`AWS_BEARER_TOKEN_BEDROCK`, so an SSO profile or an assumed role works. Vertex reads
`GOOGLE_APPLICATION_CREDENTIALS`; `gcloud auth application-default login` is usually enough.

Bedrock reads `AWS_REGION` or `AWS_DEFAULT_REGION`; region falls back to `us-east-1`. Vertex reads
`GOOGLE_CLOUD_PROJECT` or `GOOGLE_VERTEX_PROJECT`, and `GOOGLE_CLOUD_LOCATION` or
`GOOGLE_VERTEX_LOCATION`; location defaults to `global`. config wins:

```json
{
  "providers": {
    "amazon-bedrock": {
      "region": "us-west-2"
    },
    "google-vertex": {
      "project": "acme-dev",
      "location": "us-central1"
    }
  }
}
```

## a local server, or anything unlisted

if the provider prefix in the model string is unknown, it is treated as an
OpenAI-compatible endpoint. it needs a base URL, and nothing else: Ollama,
LM Studio (`http://localhost:1234/v1`), vLLM, or a gateway.

```json
{
  "model": "ollama/qwen3-coder",
  "providers": {
    "ollama": {
      "api": "http://localhost:11434/v1"
    }
  }
}
```

## check it

```bash
glrs doctor
```

a connected provider reports `credentials: found`. anything else prints
`missing:` and the variable it wants.

`/model` lists only configured providers. environment variables, keychain
markers, Bedrock profiles, Vertex application default credentials and configured
OpenAI-compatible endpoints count. Ctrl+A lists every built-in provider and its
status.

keychain reads happen only for the selected provider and at most once per
process. glrs supports macOS Keychain, Windows Credential Manager and Linux
Secret Service. when no secure store is available, use an environment variable.

see also: [models](../9-reference/4-models.md), [configuration](../9-reference/14-configuration.md)
