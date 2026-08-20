---
title: events
---

# events

an extension observes and changes a turn through `g.on`.

## g.on

```ts
export default (g) => {
  g.on("tool_call", ({ name }) => (name === "write" ? "this session is read-only" : undefined));
};
```

1. handlers run in registration order, one at a time, each awaited.
2. a handler that throws is reported and the chain continues: `<event> handler failed: <message>`, prefixed `(extension)` in the TUI, on stderr under `-p`.
3. `false` ends the chain. no later handler runs.
4. otherwise the last handler returning anything but `undefined` wins.
5. an event with an empty cell below ignores what its handlers return.

## events

| event | payload | returning |
| --- | --- | --- |
| `session_start` | `{root}` | |
| `session_end` | `{root}` | |
| `input` | `{text}` | string replaces what was typed, `false` swallows it |
| `user_bash` | `{command}` | |
| `turn_start` | `{text}` | |
| `turn_end` | `{text}` | |
| `idle` | `{}` | |
| `message` | `{kind: "text" \| "reasoning", text}` | |
| `before_request` | `{prompt, messages}` | string appended to this turn's message |
| `tool_call` | `{name, input}` | string or `false` blocks the call |
| `tool_start` | `{name, input}` | |
| `tool_end` | `{name, input, ok, result, detail, elapsedMs}` | string replaces what the model is told the tool returned |
| `model_select` | `{model, variant?}` | |
| `usage` | `{input, output, cached, cost?, contextTokens}` | |
| `reasoning` | `{text, elapsedMs}` | |
| `error` | `{message}` | |
| `compact` | `{dropped, kept, automatic}` | |
| `context` | `{messages, step}` | `ModelMessage[]` replaces what this call sends |
| `before_provider_request` | `{url, headers, body}` | `headers` merge over the request's, `body` replaces it |
| `after_provider_response` | `{url, status, headers}` | |

## print mode

`glrs -p` fires every event except `input`, `user_bash`, `model_select` and `compact`.

## sharp edges

- `context` fires once per stream attempt, not once per step. `step` is the attempt number, from 1, and a re-sent stream fires it again.
- `context` replaces what one call sends. the stored conversation is untouched.
- `before_request.messages` is a count of stored messages, not the messages. read them in `context`.
- under `-p`, `before_request.messages` is always `0`.
- a blocked `tool_call` reaches the model as the tool's result: `ERROR: <your string>`, or `ERROR: an extension blocked <name> for this turn.` for `false`. the turn continues.
- the TUI fires `idle` then `turn_end`. `-p` fires `turn_end` then `idle`.
- both hosts await `session_end`, so work on the way out finishes. the TUI's screen stops as soon as it resolves, so printing there lands nowhere.
