---
title: lifecycle
---

# lifecycle

subscribe with `g.on(name, handler)`. handlers for one event run in registration
order. modifying hooks and shutdown are awaited; notification hooks may finish
asynchronously. a thrown handler is reported without stopping the turn.

## turn order

```text
project_trust *
session_start
  input *
  turn_start
  before_agent_start *
  agent_start
  before_request *
    context *                    each model call
    before_provider_request *    each HTTP request
    after_provider_response
    message / reasoning
      tool_call *
      tool_start
      tool_end *
    usage
  agent_end
  turn_end / idle
session_shutdown
session_end
```

`*` marks events that can change what happens next.

## events

| event | payload | return value |
| --- | --- | --- |
| `project_trust` | `{ root }` | `trusted`, `denied`, or `deferred` |
| `session_start` | `{ root }` | — |
| `session_shutdown` | `{ root }` | —; awaited during shutdown |
| `session_end` | `{ root }` | —; awaited during shutdown |
| `session_before_compact` | `{ automatic, instruction }` | custom summary/instruction, or `false` |
| `session_before_switch` | `{ from, to }` | `false` blocks |
| `session_before_fork` | `{ id, at }` | `false` blocks |
| `input` | `{ text }` | string/object replaces input and may choose steer/follow-up; `false` swallows |
| `user_bash` | `{ command }` | command replacement or `false` |
| `before_agent_start` | `{ prompt, systemPrompt }` | string appends; object can replace prompt/system prompt |
| `agent_start` | `{ prompt }` | — |
| `agent_end` | `{ text }` | — |
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
| `usage` | token counts, cache read/write telemetry, provider/model/endpoint strategy, duration, and context size | — |
| `turn_end` | `{ text }` | — |
| `idle` | `{}` | — |
| `error` | `{ message }` | — |
| `model_select` | `{ model, variant }` | — |
| `compact` | `{ dropped, kept, automatic }` | — |

## input and turns

`input` fires for text submitted through the TUI. `turn_start` fires when a real
turn starts. steering enters an existing turn and does not fire another
`turn_start`.

`input`, `user_bash`, `model_select`, `compact`, and the three
`session_before_*` events do not fire in print mode.

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
fire it four times. optional `cacheRead` and `cacheWrite` preserve the difference
between a reported zero and unavailable provider telemetry; `cacheTelemetry`
names the adapter's reporting capability.

`agent_start` and `agent_end` bracket one agent run. `turn_end` contains the
final assistant text; `idle` means the queue drained.
print mode fires `turn_end` then `idle`; the TUI currently fires `idle` then
`turn_end`. `session_end` is awaited so extensions can flush state.
