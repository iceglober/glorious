---
"@glrs-dev/glrs": minor
---

Prompt caching works on every provider, to the same standard.

Caching was OpenAI-shaped throughout: a `promptCacheKey` and nothing else. OpenAI and Google cache a prompt prefix without being asked, so it worked for them — and on Anthropic and Bedrock, which cache only what is explicitly marked, it did nothing at all. Every turn re-read the whole conversation at full price on the providers where that costs the most.

The two are different seams and are handled separately. `providerOptions` carries what a provider reads about the call; a cache breakpoint has to be written into the messages. Anthropic gets `cacheControl: { type: "ephemeral", ttl: "1h" }`, Bedrock gets `cachePoint`, and a Claude model served through Vertex is marked the Anthropic way because the mark follows the model rather than the host.

The mark goes on the second-to-last message: everything up to and including it is cached, and it is the newest point that will still be present next turn. The breakpoint therefore advances every turn, which is the point — these providers match on prefix, so a longer prefix beginning with the cached one hits it and extends it rather than starting over. A conversation with nothing stable yet is left unmarked and costs nothing.

Options a message already carried are preserved rather than replaced.
