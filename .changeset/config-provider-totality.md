---
"@glrs-dev/glrs": minor
---

A provider setting either reaches the model or says why it did not.

Every provider block accepts `api`, `region`, `project` and `location`, and each provider consumes only some of them. The rest were parsed, validated, merged across config files, and then dropped without a word — `{"providers":{"anthropic":{"region":"us-east-1"}}}` looked exactly like a setting that worked.

Which settings a provider reads is now declared in one place, and two things follow from it. A key its provider does not read becomes a diagnostic naming the ones it does. And the test suite walks that table rather than checking cases someone remembered, so every key it lists is proved to survive the trip into the model options — a provider added later is covered by construction rather than by someone thinking to add a test.

This is the answer to shaping config from the AI SDK's own provider types. Importing sixteen provider packages for their settings types would tie the config schema to their release cadence, and those types describe what each client accepts rather than what glrs passes it — which is where the bugs were. The property that matters is that the mapping is total, and that is what is now checked.
