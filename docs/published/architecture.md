# Architecture

The coding-agent implementation is TypeScript in `packages/glrs-coding-agent/src/`,
run by Bun with no build step. The
public extension API is documented separately from implementation details.

## The turn loop

```
index.ts            owns the session: wiring, state, paint
  chat.ts           queues turns, pairs tool starts with ends, holds history
  agent.ts          builds the request, streams the response
  tools.ts          the tools the model can call, and the gate around them
  extension-api.ts  the surface extensions are written against
  extensions.ts     finds and loads them
  bundled/          the extensions glrs ships: builtins, web-fetch
  render.ts         everything -> Line[]
  ui/               Line[] -> the terminal, via opentui
```

`index.ts` is the only module that knows about all the others. Everything below
it takes callbacks and returns data.

One turn:

1. `chat.send(text)` queues it; `drain()` runs the queue one at a time.
2. `agent.run()` assembles `[...history, { role: "user", content: preamble + prompt }]`
   and calls `streamText`.
3. The stream is iterated part by part. Text and reasoning deltas go out as
   `onDelta`; tool calls as `onTool`; which part of the call is in flight as
   `onPhase`.
4. `index.ts` accumulates deltas and paints them once per tick, not once per
   delta.
5. When the turn ends, `chat` announces a `turn` event holding the messages, and
   `session.ts` writes them to disk.

## The prompt cache, and why the preamble exists

The system prompt must be **byte-identical** across turns, sessions and
projects. Anything that changes — the date, the branch, the dirty-file count,
the skills catalog, what extensions contributed — rides in the per-turn user
message instead, where it is frozen into history once written.

This is measured, not assumed: `eval/caching` puts the same volatile block in
each position and reports what the provider served from cache on a resumed turn.
In the system prompt: 0%. In the user message: nearly all of it. A changed
footer truncates the cached prefix at the system prompt and the entire
conversation behind it is reprocessed.

`prompt.test.ts` fails if any volatile value reappears in the system prompt.
Every preamble block must also be named in `PREAMBLE_TAGS`, or `events.ts` will
replay it into the transcript as if the user had typed it.

## Rendering

`render.ts` turns events into `Line[]` — arrays of `{ text, tone, bold, ... }`
spans — and knows nothing about terminals. `ui/chrome.ts` turns `Line[]` into
opentui `StyledText`. That seam is why extensions can draw without importing a
renderer, and why the renderer could be replaced without touching them.

The paint runs on a 100ms tick, but every writer goes through `painter()` in
`ui/screen.ts`, which keys on the rendered content and skips the render when
nothing changed. Nothing animates: a tick where no number moved costs nothing.

## Tools

`createTools` builds the built-ins. Extensions add theirs through the same
`wrapTool` wrapper, which is what makes them real tools: the same event stream
drives the live row, the same 30k cap keeps one call from eating the context,
and the same catch turns a throw into an `ERROR:` the model can recover from.

Path confinement, output caps and process-group kill live in `tools.ts` and are
not negotiable per-call — they never prompt, so they are not permission theatre.

`wrapTool` also carries the gate an extension's `tool_call`/`tool_end` handlers
drive: refuse a call before it runs, or rewrite what the model is told came
back. Because every tool goes through the same wrapper, a policy written once
covers built-ins, bundled extensions and third-party tools alike.

## Two entry points

`glrs` opens the TUI. `glrs -p "<prompt>"` runs one turn headless:
assistant text to stdout, the tool trail to stderr, extensions loaded the same
way, `ask_user` withheld because nobody is there. Print mode is how the agent
verifies changes to itself, how anything scripts glrs, and how one glrs
spawns another through `bash`.

## What is deliberately absent

No plan mode, no subagents, no MCP, no model picker, no permission prompts, no
session encryption, no animation — and no built-in slash commands or tools at
all: `/help`, `/clear`, `/skills`, `/extensions`, `/reload` and `web_fetch` are
bundled extensions. Each was removed with a reason recorded in the
commit that removed it; `git log` is the argument. What replaced all of them is
`docs/published/extensions.md`.
