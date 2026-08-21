---
"@glrs-dev/glrs": patch
---

Stop the AI SDK printing provider warnings over the TUI.

The SDK logs them with `process.emitWarning`, which writes to stderr at whatever cursor position happens to be current. Over the alternate screen that shreds the display, and `azure.responses` emits one per model call:

```
AI SDK Warning (azure.responses / gpt-5.6-luna): Non-OpenAI reasoning parts are
not supported. Skipping reasoning part: {"type":"reasoning","text":"…
```

The message embeds the part it is complaining about, so each copy carried a whole reasoning block with it: roughly 2.4kB per call, interleaved with everything glrs was drawing.

They now go where every other notice goes, clipped and said once:

```
(provider warning) azure.responses/gpt-5.6-luna: Non-OpenAI reasoning parts are
not supported. Skipping reasoning part: {"type":"reasoning","text":"The user…
```

Deduplicated per provider, model and first sentence, for the life of the process. Keying on the whole message would not have worked: the offending value sits in the rest of it, so every copy looks new. Under `-p` they go to stderr tagged `[provider]`, and the SDK's own "to turn off warning logging" notice is gone with them.

Same decision as `onError`, which has silenced the SDK's `console.error` since the alternate screen existed. The warning still travels, it just travels through glrs.
