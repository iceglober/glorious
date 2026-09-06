---
"@glrs-dev/glrs": patch
---

Cache the first turn, so the second one does not pay for it.

Anthropic and Bedrock cache only what is marked, and glrs marks the second-to-last message. On the first turn there is no second-to-last, so nothing was marked, nothing was cached, and the second turn re-read the system prompt, the tool schemas and the first message at full price.

The only message is marked instead, which is exactly the prefix the second turn opens with. Verified on the wire: the first request now carries `cache_control` on message 0.

Every other path was audited and is unchanged. OpenAI, Azure's OpenAI deployments, Google and Vertex-Gemini cache a prefix without being asked, and keep their `promptCacheKey`. Vertex-Claude marks like Anthropic. An OpenAI-compatible endpoint has no cache control the protocol defines beyond OpenAI's own, which is not sent to models that are not OpenAI's: a field the backend does not define is refused rather than ignored.
