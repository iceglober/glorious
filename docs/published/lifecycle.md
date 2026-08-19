---
title: lifecycle
---

# lifecycle

subscribe with `g.on(name, handler)`. async handlers are awaited. a thrown
handler is reported without stopping the turn.

## turn order

```text
session_start
  input *
  turn_start
  before_request *
    context *                    each model call
    before_provider_request *    each HTTP request
    after_provider_response
    message / reasoning
      tool_call *
      tool_start
      tool_end *
    usage
  idle
  turn_end
session_end
```

`*` marks events that can change what happens next.

## events

| event | payload | return value |
| --- | --- | --- |
| `session_start` | `{ root }` | — |
| `session_end` | `{ root }` | —; awaited during shutdown |
| `input` | `{ text }` | string replaces input; `false` swallows it |
| `user_bash` | `{ command }` | — |
| `turn_start` | `{ text }` | — |
| `before_request` | `{ prompt, messages }` | string appends to this turn |
| `context` | `{ messages, step }` | message array replaces this call only |
| `before_provider_request` | `{ url, headers, body }` | headers merge; body replaces |
| `after_provider_response` | `{ url, status, headers }` | — |
| `message` | `{ kind, text }` | — |
| `reasoning` | `{ text, elapsedMs }` | — |
| `tool_call` | `{ name, input }` | string or `false` blocks |
| `tool_start` | `{ name, input }` | — |
| `tool_end` | `{ name, input, ok, result, detail, elapsedMs }` | string replaces model-visible result |
| `usage` | `{ input, output, cached, cost, contextTokens }` | — |
| `turn_end` | `{ text }` | — |
| `idle` | `{}` | — |
| `error` | `{ message }` | — |
| `model_select` | `{ model, variant }` | — |
| `compact` | `{ dropped, kept, automatic }` | — |

## input and turns

`input` fires for text submitted through the TUI. `turn_start` fires when a real
turn starts. steering enters an existing turn and does not fire another
`turn_start`.

`user_bash`, `input`, and model-selection UI events do not exist in print mode.

## request layers

- `before_request` runs once per turn and appends text to its message
- `context` runs before every model call and can replace that call's messages
- `before_provider_request` sees the final HTTP payload
- `after_provider_response` sees status and headers before the body is read

context replacement never rewrites stored history.

## tools

`tool_call` can refuse based on arguments. the model receives the reason.

`g.filterTools()` is different: it removes a tool from the schema before the
model can choose it.

`tool_end` can redact or replace a result after execution. the replacement is
what the model and transcript receive.

## usage and completion

`usage` fires once per model call. a turn that runs three rounds of tools may
fire it four times.

`idle` fires after the queue drains. `turn_end` then contains the final assistant
text. `session_end` is awaited so extensions can flush state.
