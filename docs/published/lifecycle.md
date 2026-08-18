# Lifecycle

Every event an extension can subscribe to, in the order it fires. Names in
**bold** can change what happens next; the rest are notifications.

Both hosts fire everything here except four events that have no meaning without
a composer — `input`, `user_bash`, `model_select` and `compact`. A test enforces
that, so this page cannot drift from the code.

## A turn, end to end

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant G as glorious
    participant X as extensions
    participant M as model

    Note over G,X: startup
    G->>X: session_start { root }

    You->>G: type a prompt
    G->>X: **input** { text }
    Note right of X: a string replaces it · false swallows it
    G->>X: **turn_start** { text }
    Note right of X: false cancels the turn
    G->>X: **before_request** { prompt, messages }
    Note right of X: a string is appended to this turn's message

    loop one pass per model call
        G->>X: **context** { messages, step }
        Note right of X: an array replaces what is sent — history is untouched
        G->>X: **before_provider_request** { url, headers, body }
        Note right of X: headers merge · a body replaces
        G->>M: HTTP request
        M-->>G: status + headers
        G->>X: after_provider_response { url, status, headers }
        M-->>G: streamed response
        G->>X: message { kind, text }
        G->>X: reasoning { text, elapsedMs }

        opt the model calls a tool
            G->>X: **tool_call** { name, input }
            Note right of X: false or a string blocks it, and the model is told why
            G->>X: tool_start { name, input }
            G->>X: **tool_end** { name, input, ok, result, … }
            Note right of X: a string replaces what the model is told
        end

        G->>X: usage { input, output, cached, cost, contextTokens }
    end

    G->>X: turn_end { text }
    G->>X: idle
    G-->>You: the answer
```

## Everything else

```mermaid
sequenceDiagram
    autonumber
    actor You
    participant G as glorious
    participant X as extensions

    You->>G: `!command`
    G->>X: user_bash { command }

    You->>G: /compact, or the window fills
    G->>X: compact { dropped, kept, automatic }

    You->>G: switch model
    G->>X: model_select { model, variant }

    Note over G,X: a turn that fails
    G->>X: error { message }

    You->>G: quit
    G->>X: session_end { root }
    Note right of X: awaited, so a flush finishes before teardown
```

## What each one is for

| Event | Fires | Returning something |
| --- | --- | --- |
| `session_start` | once, before the first turn | — |
| `session_end` | on the way out | — (awaited) |
| `input` | you pressed Enter | a string replaces it; `false` swallows it |
| `user_bash` | you ran `!command` | — |
| `turn_start` | a turn is starting | `false` cancels it |
| `before_request` | before the model is called | a string is appended to this turn's message |
| `context` | before **each** model call | an array replaces the messages for that call |
| `before_provider_request` | before the HTTP request | `{ headers }` merges, `{ body }` replaces |
| `after_provider_response` | headers arrived, body not yet read | — |
| `message` | text and reasoning, as they stream | — |
| `reasoning` | the model stopped thinking | — |
| `tool_call` | before a tool runs | `false` or a string blocks it |
| `tool_start` | the tool is running | — |
| `tool_end` | the tool returned | a string replaces what the model is told |
| `usage` | once per model call | — |
| `turn_end` | the turn produced its answer | — |
| `idle` | nothing running, nothing queued | — |
| `error` | the turn failed | — |
| `model_select` | the model changed | — |
| `compact` | the conversation was summarised | — |

## Three that are easy to confuse

- **`before_request` appends, `context` replaces.** `before_request` fires once per turn and adds a string to the message you sent. `context` fires once per *model call* — a turn running three tools fires it four times — and hands you every message, so it is where filtering, windowing and redaction go. Neither changes stored history: `context` changes only what that one call sends.
- **`tool_call` refuses, `filterTools` withholds.** A refusal reaches the model with your reason, which is what you want when the answer depends on the arguments. A filter removes the tool from the schema, so the model never knew it existed. Withholding cannot be argued with.
- **`before_provider_request` is the last word.** It sees the payload exactly as the provider will, after everything else has run. A gateway, a signing proxy, per-request auth and request logging all live there.
