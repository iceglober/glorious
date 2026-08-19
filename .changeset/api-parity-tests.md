---
"@glrs-dev/glrs": minor
---

Every extension API member is tested, and every lifecycle event fires in both hosts.

Nineteen of the API's forty members had never been named in a test. That is how
`before_request` came to fire in the TUI and silently do nothing under `-p` — an
extension injecting per-turn context worked interactively and was inert
headlessly, which is the mode the agent uses to check its own work, so the gap
concealed itself.

**Five events now fire in print mode that did not:** `before_request`,
`message`, `reasoning`, `error` and `session_end`. `input`, `user_bash`,
`model_select` and `compact` remain TUI-only, and a test names each one with the
reason.

**Two guards keep it that way.** A Proxy records every member the tests touch,
so adding an API member without testing it fails the build rather than shipping
untested. A parity test asserts every event fires in both hosts unless it is on
the exceptions list, and that the list contains no stale names. Both were
verified to fail against the code they were written to catch.
