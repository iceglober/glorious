---
"@glrs-dev/glrs": patch
---

Use the environment credential the provider picker already reports as available.

A provider can be reached under several environment variable names — azure answers to `AZURE_FOUNDRY_API_KEY`, `AZURE_API_KEY` and `AZURE_OPENAI_API_KEY` — but each SDK falls back to exactly one. The picker reported a provider as connected on any of them, while the session was started with none of them, so a shell holding only `AZURE_OPENAI_API_KEY` failed every first message with "Azure OpenAI API key is missing" and only recovered after connecting the provider by hand in `/models`. The key is now resolved from the same list the picker checks, so "environment credentials available" means the session can actually start.
