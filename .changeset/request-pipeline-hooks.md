---
"@glrs-dev/glrs": minor
---

The request pipeline is interceptable, and the lifecycle is documented.

Three new events close the two biggest gaps in the extension API.

**`context`** fires before *each* model call — a turn running three tools fires
it four times — and hands over every message. Returning an array replaces what
is sent for that call only, so filtering, windowing and redaction are possible
and stored history is never rewritten. `before_request` could only append a
string to the turn's message.

**`before_provider_request`** sees the HTTP request as the provider will:
returning `{ headers }` merges them, returning `{ body }` replaces it. Gateways,
signing proxies, per-request auth and request logging live here.
**`after_provider_response`** sees the status and headers before the body is
read, which is where rate-limit budgets and request ids arrive.

Handler return types are now per-event. `HandlerVerdict` was one loose
`string | false` shared by every event, so a handler could return a value to an
event that ignores it and nothing said so — the compiler now rejects it.

New `docs/published/lifecycle.md`: a sequence diagram of a turn from prompt to
answer, plus a table of every event and what returning something does. Two tests
keep it honest — every event must appear on the page, and the page may not
invent one.
