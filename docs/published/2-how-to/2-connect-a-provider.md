---
title: connect a provider
---

# connect a provider

set the credential, then check it with `glrs doctor`: a connected provider reports
`credentials: found`, anything else prints `missing:` and the variable it wants.

## a keyed provider

```bash
export ANTHROPIC_API_KEY=sk-…
GLRS_MODEL=anthropic/claude-opus-5 glrs doctor
```

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

an unknown prefix is an OpenAI-compatible endpoint and needs a base URL: Ollama, LM Studio
(`http://localhost:1234/v1`), vLLM, a gateway. `doctor` reports `missing: providers.<id>.api …`.

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

model ids and precedence: [models](../9-reference/2-models.md).

see also: [models](../9-reference/2-models.md), [configuration](../9-reference/8-configuration.md)
