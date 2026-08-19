---
"@glrs-dev/glrs": minor
---

Two ways to send a message while the agent is working, and one key that takes any of them back.

`Enter` queues a follow-up: it waits until the agent has finished everything and then becomes its own turn. `Alt+Enter` queues a steering message, which joins the turn that is already running. Enter is the follow-up because it is the one that cannot make things worse — it has no way to change what the running turn does — and steering is the deliberate act, so it carries the modifier.

Steering is real now rather than a name for jumping the queue. It used to mean "become the next turn", which only helped after the model had already spent twenty steps going the wrong way. A steering message is appended to what the model sees at the next step boundary, through the AI SDK's `prepareStep`, so it is read before the next action is chosen and the turn is neither restarted nor thrown away. Appending keeps the cached prefix intact, so steering costs the tokens of what was said and nothing else. The message is spliced back into the turn's stored messages at the position it was delivered — left at the end, the assistant would appear to have answered something the conversation never says was asked, and a later compaction would summarise it in the wrong order. A dropped stream is re-sent from the first step, so anything the dead attempt took goes back in the queue rather than being delivered only to a request that was discarded.

`Alt+↑` lifts the newest waiting message out of the queue and into the composer. There is no separate rescind and no separate edit, because taking it back is both: retype it and press Enter, or clear the line and it is gone. A slash command comes back as `/review` rather than the page of prompt it expands into.

`Esc` now has one job. It stops the running turn and holds the queue rather than marching it on into whatever state the interrupt left behind — and it no longer pulls a queued message into the composer, which is what used to make Esc during a turn look like it had done nothing. `Enter` on an empty composer releases the hold; so does sending anything else.

Two settings, `steering_mode` and `follow_up_mode`, choose whether one waiting message is delivered at a time (the default, so the model answers what you said before it reads what you said next) or all of them at once. Both are also read as `steeringMode` and `followUpMode`.

New `terminal-setup` page: on Windows Terminal `Alt+Enter` is fullscreen and never reaches glorious, so it documents the remap. Alt is accepted under both conventions terminals use for it — the `ESC` prefix and the kitty protocol's modifier bit — so the chords work in terminals that speak neither exclusively.
