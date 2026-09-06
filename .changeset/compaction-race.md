---
"@glrs-dev/glrs": minor
---

Stop a turn from throwing away the compaction it raced, and let the threshold move.

Automatic compaction runs while the session is idle, and `pump()` did not know about it. Type while a summary is being written and a turn starts alongside it; the compaction lands first and rewrites the prefix, then the turn lands and overwrites `history` with the full uncompacted set. The summary was computed, paid for, and discarded. A real session shows it: two compactions recorded and context still peaking at 915,852 of 1,050,000.

A turn only appends, so the brief now waits for it and is spliced into the prefix once the turn has landed. If the history has somehow become shorter than the cut it was made from, the brief is dropped instead: that costs one summary, where splicing would cost the conversation.

**`compactAt` is configurable.** It defaults to the same `0.75`, but on a million-token model that is 787,500 tokens, which is late and expensive on every turn that reaches it:

```json
{ "compactAt": 0.5 }
```

`0` turns automatic compaction off and leaves `/compact` working. A value at or above `1` would only fire once the window was already exceeded, so it is refused.

Automatic compaction still needs a context window to measure against, and a model the catalogue does not know has none: every OpenAI-compatible endpoint, including `azure-foundry`, reports `ctx unknown` and is never compacted automatically unless `providers.<id>.models.<id>.metadata.context` supplies the number. Now documented rather than silent.

**A turn now stops before it exceeds the window.** `maybeCompact` runs at idle and `preflightCompact` before a new message; neither looks between the steps of a turn. An agentic turn reading several large files can go from under the trigger to past the window inside itself, and be refused with `Your input exceeds the context window of this model` having never been offered a compaction. The turn now stops at its next step boundary once the provider reports input past the same threshold compaction uses, says `(compacting to make room: send "continue" to resume)`, and compaction follows at idle. A model with no known window has no ceiling and is left to the provider, as before.
