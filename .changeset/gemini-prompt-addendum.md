---
"@glrs-dev/glrs": patch
---

Add model-family prompt addenda, matched against the complete `provider/model` ref, and use one to curb Gemini's over-eager background jobs. Gemini models (any provider — `vertex/gemini-*`, `google/gemini-*`) were calling `run_background_job` for plain questions; the addendum keeps the agent free to start a job on its own but makes the good reasons concrete — the user explicitly asking for background/parallel work, or work that genuinely must run detached (a CI run, a code review, a deploy) — so a question gets answered directly instead. Addenda are appended inside the version-hashed prompt body, so they don't collide across model families in the prompt cache.
