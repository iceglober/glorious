---
"@glrs-dev/glrs": patch
---

Stop turns dying with `Item with id 'rs_…' not found`.

The OpenAI provider defaults `store` to true, which makes it replay earlier assistant text and reasoning as `{type: "item_reference", id: "…"}` — asking the service to look up content it stored server-side — instead of sending that content. Whenever a lookup missed, the whole turn failed. glorious sends its complete history on every request, so it gains nothing from server-side state; `store: false` now sends the content inline, and makes the provider request `reasoning.encrypted_content` so reasoning stays replayable.

Measured on the wire across a multi-turn session: item references went from growing every turn (2, 2, 3, …) to **zero**, with encrypted reasoning carried inline instead. Prompt caching is unaffected. Sessions recorded before this fix already carry the encrypted content, so they resume without any migration.
