---
"@glrs-dev/glorious": patch
---

Stop a failed turn from shredding the screen.

`streamText`'s default error handler is `console.error`, which writes a raw stack trace straight to the terminal — landing at whatever cursor position the TUI happened to be at, interleaved with the transcript and the composer. A failed model call now renders as a single error line, as it did before streaming.

Two supporting fixes: the promises carrying a turn's final text, messages and steps are subscribed before the stream is iterated, so a mid-stream failure cannot strand them as unhandled rejections (three per failure, each printed to stderr); and an error arriving as a stream part is now thrown rather than silently ending the turn as if it had produced nothing. A process-level guard routes any remaining stray runtime output into the transcript instead of over the screen.
