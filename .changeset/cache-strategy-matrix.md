---
"@glrs-dev/glrs": patch
---

Keep prompt caching aligned with the selected endpoint adapter: OpenAI and Azure Responses/Chat receive stable routing keys, Anthropic and Bedrock receive message breakpoints, compatible endpoints receive no unsupported cache fields, and extension providers retain ownership of caching.
