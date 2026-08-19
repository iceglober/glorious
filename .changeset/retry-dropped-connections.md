---
"@glrs-dev/glrs": patch
---

Retry a dropped connection instead of killing the turn.

A turn could die with `The socket connection was closed unexpectedly. For more information, pass \`verbose: true\` in the second argument to fetch()` — a message about a fetch you never called, on a failure that a retry exists for.

The retry filter matched on `error.name`, but Bun reports a dropped connection as a plain `Error` whose name is `"Error"`; the only signal is `code: "ECONNRESET"`. Nothing matched, so the failure was treated as permanent and the first network blip ended the turn. It now matches on `code` as well: ECONNRESET, ECONNREFUSED, ECONNABORTED, EPIPE, ETIMEDOUT, EHOSTUNREACH, ENETUNREACH, ENETDOWN and EAI_AGAIN. ENOTFOUND is deliberately absent — a hostname that does not exist will not start existing on the third attempt.

That covers a connection lost before the response begins, which is retried transparently. One lost *mid-response* cannot be: tokens may already be on screen and replaying the request would duplicate them. For that case the message is now one you can act on — "the connection to the model dropped mid-response — send \"continue\" to pick up where it stopped" — and the failure already leaves a reminder on the next turn, so the model knows what it was doing. Bare `fetch failed`, ECONNREFUSED and DNS failures get the same treatment.
