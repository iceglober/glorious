---
"@glrs-dev/glrs": minor
---

`/fork` copies this session to a new id, so you can branch and come back.

`forkSession` was written, complete and correct — it slices a session's events at a point, mints a fresh id, recomputes the context count and saves. It was reachable only through a repository object whose single consumer was the SDK entry nothing can import, so it had never run outside its own file and had no test.

`/fork` calls it. `/fork 12` cuts at the twelfth event, `/fork` alone copies the lot, and either way it prints the `glrs --resume <id>` that opens the copy. The original is untouched.

Nothing about this needed a new API member. `g.session()` already names the session and an extension may reach `glrs-core`, so the command is written with exactly the surface a third-party extension has — which is the point: a first-party command that needed a private door would mean the public one was incomplete.

`Tone` and `Span` are declared once now, which is what forced this into the open: the renderer paints seven tones and the type extensions import named five, so `/fork` could not report success in the success tone. `italic` and `underline` were honoured by the renderer and missing from the type in the same way.
