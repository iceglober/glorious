---
"@glrs-dev/glrs": minor
---

Compaction, `@file` references, piped input, readable listings — and two queue bugs.

**Compaction.** A conversation past 75% of the model's window is summarised automatically: the older part becomes a brief, recent turns stay verbatim. `/compact [instruction]` does it on demand. The cut always lands on a user message, because a tool result separated from the call it answers is an invalid request that the provider rejects outright. A resumed session inherits the compaction rather than re-inflating to the full history and hitting the same limit on its first turn. This was the only gap that made a long session *fail* rather than merely be less convenient.

**`@path` references.** The path stays in the message the transcript shows — it is what you typed — and the file's contents ride along fenced. `@` completes against project files in the composer. A path that escapes the project is left as written, so an email address is just text, and a missing file is reported rather than silently dropped.

**Piped input.** `cat log | glorious -p "what failed?"` merges stdin into the prompt, fenced as material. Previously piped input was discarded entirely.

**Readable listings.** `/help`, `/skills` and `/extensions` were ragged one-per-line lists with absolute paths on their own lines, three of which turned a five-line listing into fifteen. They are now aligned columns with the origin as a word — `bundled`, `project`, `personal` — which is the part that actually matters. Adds `/session`: id, context, tokens, cache hit rate and cost. Extensions get `g.columns()` and `g.clip()` so anyone can draw a table that fits.

**Provider names people actually type.** `vertex`, `bedrock`, `gemini`, `claude`, `foundry`, `together`, `grok` and others resolve to the built-in provider. The canonical ids follow the SDK packages, which is fine for identifiers and not what anyone reaches for — `glorious --model vertex/gemini-3.7-flash` used to report Vertex as an unknown OpenAI-compatible endpoint and ask for a base URL. A genuine near-miss now names the provider it thinks you meant.

**Two queue bugs, both reported from live sessions.** Esc dequeued before it aborted, so pressing it during a turn with anything queued silently pulled the queued message back into the composer and let the turn run on — the message was never sent and nothing about the turn changed, which reads as Esc doing nothing. It now stops the turn and leaves the queue alone, and taking a message back says loudly where the text went.

The interrupt reminder led the prompt, ahead of what was typed. A model that had just been interrupted answered the reminder instead of the request — replying "Retried successfully" to a page of new instructions. The request leads now; the reminder trails it.

New: `docs/features.md`, the built-in feature set in one place.
