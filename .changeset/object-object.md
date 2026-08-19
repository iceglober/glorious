---
"@glrs-dev/glrs": patch
---

A failed turn no longer reports `[object Object]`.

`errorText` used `String(thrown)` for anything that was not an `Error` — and
provider SDKs throw plain objects routinely, so a turn could fail and the
transcript would say nothing at all about why.

It now digs the message out: a nested `error`, a response `body`, an empty
`Error` with a populated `cause`, the first of an `errors` array. Anything
genuinely unrecognisable is serialised, because a wall of JSON is worth more
than `[object Object]`. Extension load failures go through the same path.

Observed shape, before and after:

```
{ status: 400, error: { message: "This model's maximum context length is 272000 tokens." } }
before: [object Object]
after:  This model's maximum context length is 272000 tokens.
```
