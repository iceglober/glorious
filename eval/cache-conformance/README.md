# Provider cache conformance

This opt-in live probe distinguishes request-shape coverage from evidence that a provider actually served cached input. It sends the same long prefix twice and requires the warm request to report cache-read tokens.

Set standard provider credentials plus one or more model/deployment variables:

```sh
export GLRS_RUN_LIVE_CACHE_EVAL=1
export GLRS_CACHE_EVAL_AZURE_RESPONSES_MODEL=...
export GLRS_CACHE_EVAL_AZURE_CHAT_MODEL=...
export GLRS_CACHE_EVAL_AZURE_DEEPSEEK_MODEL=...
export GLRS_CACHE_EVAL_ANTHROPIC_MODEL=...
export GLRS_CACHE_EVAL_VERTEX_GEMINI_MODEL=...
export GLRS_CACHE_EVAL_VERTEX_CLAUDE_MODEL=...
bun eval/cache-conformance/run.ts
```

Azure uses `AZURE_FOUNDRY_API_KEY`, `AZURE_API_KEY`, or `AZURE_OPENAI_API_KEY` and `AZURE_RESOURCE_NAME`. Vertex uses application default credentials plus `GOOGLE_CLOUD_PROJECT`/`GOOGLE_VERTEX_PROJECT` and an optional location.

`results.json` contains only token counts, durations, route names, and pass/fail results. It is ignored by git. Live probes are intentionally excluded from CI because they require credentials, spend tokens, and test external service behavior.
