---
title: how glrs works
---

# how glrs works

a model, tools, context, and a turn loop over a git repository. that is the
whole of it. everything else — the six tools that touch the machine, every
slash command, the question widget, the worktree subcommand — arrives as an
extension, registered through the same API a file in `.glrs/extensions/` uses.
the core registers no tools and no commands at all. that is the test: if
`/help` or `bash` could not be written as an extension, "extensible" would be a
claim rather than a fact.

the same reasoning decides what glrs reads about itself. `docsPath()` points
the agent at this directory and not at `packages/`: the documented API is the
contract it writes extensions against, and handing it the implementation
invites it to reach past that contract and couple to internals that are free to
change. a wrong sentence on this page becomes a wrong extension later.

## the system prompt

roughly forty lines. it names the identity, eight working guidelines, and where
these docs are, then fences whatever `AGENTS.md`, `AGENT.md` or `CLAUDE.md`
supplied into `<repo-rules>`. nothing else.

it is re-sent on every model call, and a provider caches a prompt prefix only
for as long as the prefix does not move — so it is kept byte-identical across
turns and across sessions. the date, the working directory, git state, the
skills catalogue and every extension's contribution are volatile, so they ride
in the per-turn user message instead, where changing them costs the tokens of
the block that changed and nothing else. `prompt.test.ts` fails if any of that
reappears in the system prompt.

it is *not* identical across projects. the repo rules are inside it, so two
checkouts with different `AGENTS.md` files produce two different system prompts,
each stable for as long as its own rules file is.

## the packages

| package | owns |
| --- | --- |
| `glrs-core` | session records, the lifecycle event vocabulary, the shell primitive, the extension API type |
| `provider-registry` | config files and their diagnostics, the provider table, credentials, model resolution, request shaping |
| `glrs-coding-agent` | argv routing, the turn loop, the three hosts, discovery, the extension host |
| `packages/extensions/*` | ask-user, builtins, web-fetch, worktree |

`scripts/check-boundaries.ts` enforces the direction: core imports neither of
the others, and `packages/extensions` imports neither the coding agent nor the
provider registry. that is why the `Glrs` type is declared in core rather than
beside the object implementing it — a shipped extension has to be able to name
the API it is handed. it was two types once, the real one and a copy for
extensions to import, and they drifted to 44 members against 26: `model`,
`flag`, `abort` and fifteen more existed at runtime and were invisible to
anyone writing against the type.

## three hosts, one core

`g.mode` says which one you are in.

- **tui** — the alternate screen. a transcript, two message queues, a session
  file, and a 100 ms paint tick with unchanged frames dropped before they reach
  the renderer. nothing animates; the only thing moving between ticks is an
  elapsed reading.
- **print** — `glrs -p`, one turn, no session file. assistant text goes to
  stdout and the tool trail to stderr, which is what makes it composable: it is
  how the agent verifies its own changes, and how one glrs spawns another
  through `bash` with every step of the child visible in the parent's output.
  members with no headless meaning refuse out loud rather than doing nothing
  quietly — `ui.capture()` throws, `send()` and `reload()` write a note to
  stderr.
- **cli** — a subcommand an extension registered, such as `glrs wt list`. it
  loads the extensions, hands one its arguments, and exits. no model, no screen,
  no session, so every session-bound member throws by name rather than returning
  a plausible empty value.

the TUI and print build the same agent over the same config, extensions and
skills. what differs is the surface, and what an extension makes of it:
`ask_user` registers itself only where `g.hasUI` is true, because a tool that
opens a widget nobody is watching would hang the model on an answer that cannot
arrive. cli loads the same extensions and builds no agent at all.

## a turn, end to end

a follow-up message waits for the agent to run out of work; a steering message
joins the turn already running. when one is delivered:

1. the transcript records it. a delivery with no label is a `user` event and
   fires `turn_start`. one carrying a label — a slash command's expanded body,
   `g.send(text, { label })`, a message whose `@path` mentions were expanded —
   is recorded as a `notice` under that label instead, so `turn_start` does not
   fire for it and the session is not buried under a page of expanded prompt.
2. if the previous turn was interrupted, failed, or hit the step limit, a
   `[system-reminder]` block is appended saying so. it trails the request
   rather than leading it: it led once, and a model that had just been
   interrupted answered the reminder instead of the question.
3. `before_request` fires. a string returned by a handler is appended to this
   turn's message.
4. the per-turn preamble is assembled ahead of the prompt: `<where-you-are>`
   with os, date, directory and git state; `<skills>` with the catalogue; and
   `<extensions>` with every contribution registered through `g.prompt`, plus —
   in the TUI — the first-party extensions still undecided, an offer that stops
   being made once you have answered it. those three tags and the
   `[system-reminder]` brackets are named in one list, and that list is what
   strips them back off when a transcript is rebuilt from the stored provider
   messages — a preamble block not on it would show up as though the user had
   typed it.
5. `context` fires with the whole message list. returning an array replaces
   what is sent for this attempt; the stored conversation is untouched, so
   redacting or windowing here never rewrites history.
6. cache breakpoints are written, for the two providers that cache only what is
   marked. [models and providers](./2-models.md) has where the mark goes and
   why it moves each turn.
7. one provider stream carries the whole turn. the multi-step tool loop runs
   *inside* that single call: the model calls tools, results come back, it calls
   more, and only the final text ends the stream. between steps the queue is
   asked for steering messages, which are appended so the cached prefix survives.
   the turn stops at 100 model steps; stopping there without final text prints
   `(step limit reached — send "continue" to resume)`, and under `-p` writes
   `[stopped at the step limit without finishing]` to stderr and exits 1.
8. each HTTP request fires `before_provider_request` and
   `after_provider_response`, and carries its own deadlines — 30 minutes, then
   10, then 10 — which cover a request that fails while it is being made.
9. each model call inside the stream reports `usage`: input, output, cached,
   cost, and the context size the provider observed. three rounds of tools
   report four times.
10. `idle` fires, the compaction check runs, any skill's tool restriction is
    lifted, `turn_end` fires, and the session is written.

### a stream that died

a connection can drop long after `fetch()` resolved, while the body is being
read, and the deadline retry underneath cannot see that. so a dropped stream is
re-sent — but only while the attempt is unobservable: nothing written, nothing
thought aloud, no tool run. once a tool has run the world has moved, and the
failure surfaces instead. steering messages the dead attempt took out of the
queue go back into it. [models and providers](./2-models.md) has all three retry
layers and what counts as retryable at each.

### compaction

when the provider reports the conversation past 75% of the model's context
window, glrs summarises the older part at the next `idle` and carries the brief
forward as a single `<earlier-conversation>` message. the summarising call runs
without tools and under its own cache scope, so it cannot evict the
conversation's own prefix. where the cut lands, why it has to be a user message,
and what `/compact` does differently are in
[models and providers](./2-models.md).

## lifecycle events

subscribe with `g.on(name, handler)`. handlers run in registration order and
are awaited. a handler that throws is reported — into the transcript in the
TUI, to stderr under `-p` — and the chain continues, because an extension is
third-party code and the session is not. `false` ends the chain immediately —
no later handler can undo another's refusal — and otherwise the **last**
non-undefined return wins.

| event | payload | return value |
| --- | --- | --- |
| `session_start` | `{ root }` | — |
| `input` | `{ text }` | string replaces what was typed; `false` swallows it |
| `user_bash` | `{ command }` | — |
| `turn_start` | `{ text }` | — |
| `before_request` | `{ prompt, messages }` | string appends to this turn's message |
| `context` | `{ messages, step }` | array replaces the messages for this attempt |
| `before_provider_request` | `{ url, headers, body }` | headers merge; body replaces |
| `after_provider_response` | `{ url, status, headers }` | — |
| `message` | `{ kind, text }` | — |
| `reasoning` | `{ text, elapsedMs }` | — |
| `tool_call` | `{ name, input }` | `false` blocks; a string blocks with that reason |
| `tool_start` | `{ name, input }` | — |
| `tool_end` | `{ name, input, ok, result, detail, elapsedMs }` | string replaces what the model is told |
| `usage` | `{ input, output, cached, cost, contextTokens }` | — |
| `error` | `{ message }` | — |
| `model_select` | `{ model, variant }` | — |
| `compact` | `{ dropped, kept, automatic }` | — |
| `idle` | `{}` | — |
| `turn_end` | `{ text }` | — |
| `session_end` | `{ root }` | —; awaited before the process exits |

`input`, `user_bash`, `model_select` and `compact` do not fire in print mode:
there is no composer to type into, `!` is a composer key, a one-shot run cannot
switch models and never compacts. every other event fires in both hosts, and a
test in `extension-api.test.ts` fails if one stops doing so. `input` fires for
everything submitted through the composer, steering included; `g.send()` does
not go through it, so an extension that starts a turn cannot trip its own
handler.

### sharp edges

**`context` fires once per provider stream attempt, not once per model call.**
a turn with three rounds of tools fires it once — the tool loop runs inside a
single `streamText` call and never consults it. it fires a second time only if
the stream drops and is re-sent. `step` is therefore the attempt number, 1 on
the first send. an extension written as though `context` runs per model call
will do nothing on calls two and three and will double its work on a retry.

**`before_request`'s `messages` is a count, not an array.** it is the length of
the conversation the model is about to be handed, and it is always `0` in print
mode, where there is no history. use `context` when you need the messages
themselves.

**a blocked tool call reaches the model as an error string.** returning `false`
from `tool_call` sends `ERROR: an extension blocked <name> for this turn.`;
returning a string sends `ERROR: <your reason>`. the call never runs, and the
model reads the refusal as that tool's result. `g.filterTools()` is the other
half of the pair and the stronger one: it withholds the tool from the schema
entirely — see [tools](./4-tools.md).

**the two hosts end a turn in opposite order.** the TUI fires `idle` and then
`turn_end`; print mode fires `turn_end` and then `idle`. an extension that
reports totals should hook the one it means rather than assuming they are
adjacent. `session_end` is awaited in both, so an extension that writes a file
or posts a result on the way out actually finishes — though it cannot usefully
print, since the screen stops as soon as it resolves.

## sessions on disk

one JSON file per session, at `$XDG_DATA_HOME/glrs/sessions/<id>.json`
(`~/.local/share/glrs/sessions` by default), holding `schema`, `id`,
`createdAt`, `updatedAt`, `cwd`, `contextTokens` and an ordered event log. they
were encrypted once, under a Keychain key, which bought little against a
transcript sitting on the same disk as the repo it is about and cost a prompt
that has nowhere to go under a pty. observability is the point: `cat` the file.

the log carries what the transcript redraws from — `user` (with a `steer` flag
when it joined a running turn), `assistant`, `tool` with its input, result,
duration and outcome, `reasoning`, `notice`, `error`, `usage`, `cleared`,
`compacted` — and, separately, `turn` events holding the raw provider messages.
`custom` entries are an extension's own data: persisted, never sent to the
model, and read back with `g.entries(type)`.

`glrs --resume <id>` replays all of it. the conversation the model sees restarts
at the last `cleared` or `compacted` event, so a resumed session inherits the
trimmed context the live one had instead of re-inflating to the full history and
blowing the limit on the first turn. usage totals do not restart there: they sum
every `usage` event in the file, because clearing drops what the model replays,
not what the run cost. extension entries survive the same way.

print mode writes no session file at all, and takes a fresh id of the form
`print-<8 hex>` per run — that id becomes the provider's prompt cache key, and a
constant one would tell the backend that two unrelated runs were the same
conversation.

## embedding the core

`@glrs-dev/glrs` resolves to `sdk.ts`. it exports the contracts a host needs —
`AgentCore`, `Session`, `SessionEvent`, `SessionRepository`, `Turn`,
`ModelProvider`, `ProviderAdapter`, `ProviderRegistry`, `Extension`,
`CodingAgent`, `CodingAgentDependencies` — and four values: `createAgentCore`,
`createCodingAgent`, `jsonSessionRepository`, which is the plain-JSON session
store described above, and `createProviderRegistry`, which returns an empty
`register`/`get`/`list` over provider adapters.

be clear about what it does not do. `createAgentCore` takes your `session`, your
`runTurn` and your `reloadExtensions` and hands them back on an object;
`createCodingAgent` bundles that runtime with a session repository, a provider
registry and any extensions you constructed. neither composes the turn loop,
the tool set, extension discovery or the TUI — those live in
`glrs-coding-agent` and are
reached by running `glrs`. this is a boundary for a host that wants glrs's
session format and provider vocabulary under its own runtime, not glrs in a
library. extension authors want `@glrs-dev/glrs/extension-api` instead, which
exports `Glrs` and every type an extension names — see
[extensions](./8-extensions.md).
