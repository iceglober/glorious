---
"@glrs-dev/glrs": minor
---

Reach any Azure Foundry deployment, not only the OpenAI ones.

```bash
GLRS_MODEL=azure-foundry/grok-4.6 glrs -p "hello"
```

No config. The base URL comes from `AZURE_RESOURCE_NAME` and the key from the same variables `azure` reads, sent as the `api-key` header Azure wants rather than a bearer token. Verified end to end against grok, kimi and deepseek deployments.

Three defects were in the way, and the first two affect every OpenAI-compatible endpoint, not just Azure.

**Provider options were written under a key nothing reads.** The compatible client reads `providerOptions[<the name it was built with>]` and glrs builds it with the provider id, but glrs always wrote `providerOptions.openai`. So every option shaped for Ollama, vLLM, a gateway or a Foundry deployment was dropped without a word. The namespace is now the provider id, camelCased, which is the spelling the client wants: `azure-foundry` works and is deprecated, `azureFoundry` is not.

**Options only OpenAI understands were sent to models that are not OpenAI.** `textVerbosity` and `store` went to everything. `azure/grok-4.6` answered

```
Unsupported value: 'low' is not supported with the 'grok-4.6-1' model.
```

which reads like a reasoning-effort problem and is `textVerbosity`. Now only `openai` and Azure deployments whose `modelType` is the OpenAI surface get them; everything else gets reasoning effort, which most of them read.

**Azure authenticates with a header the generic path does not send.** An unknown provider resolves no credential at all, which is why reaching a non-OpenAI Foundry deployment previously needed an extension injecting `api-key` on every request.
