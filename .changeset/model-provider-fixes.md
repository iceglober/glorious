---
"@glrs-dev/glrs": major
---

No default model, no default provider, and every provider is asked in its own words.

**There is no default.** `model` fell back to `azure/gpt-5.6-luna`, and a model id naming no provider meant azure. So the most likely provider was the one nobody chose — and it was the single branch that dropped `providers.azure.api`, meaning a gateway or private resource silently went to the public endpoint. The guess and the misconfiguration compounded. Both are gone: nothing configured is an error naming the three ways to set one, and `glrs doctor` reports it as a state rather than dying on it, listing the providers that ship.

**Azure gets its base URL**, like every other provider. `createAzure` was called without `baseURL` while `amazon-bedrock` three lines below passed it.

**`providers.<id>.api` survives for bedrock and vertex.** It parsed, validated, merged, and then vanished before the model was built.

**`variant` reaches the provider that will answer it.** The whole options object was nested under the `openai` namespace whatever the provider was. The openai SDK also serves azure, so those two worked and the other fourteen received a key they do not read — `{"model":"anthropic/…","variant":"high"}` parsed, passed `doctor`, and did nothing at all.

Reasoning effort is not one setting with one spelling, so it is now translated per provider, with the shapes read out of the installed SDKs rather than assumed:

| provider | what is sent |
| --- | --- |
| openai, azure, OpenAI-compatible | `reasoningEffort` |
| anthropic | `thinking: { type: "enabled", budgetTokens }` |
| google | `thinkingConfig: { thinkingBudget, includeThoughts }` |
| amazon-bedrock | `reasoningConfig: { type, budgetTokens, maxReasoningEffort }` |

Vertex follows the model rather than the host, so an Anthropic model served through vertex is asked the Anthropic way.

**A provider's `note` reaches `doctor`.** ADC for vertex and the credential chain for bedrock were written on the spec and read by nobody, so `doctor` said a credential was missing without saying how to supply it.

`compatibleNote` existed three times — once exported and unreferenced, twice inline. It is one function now.
