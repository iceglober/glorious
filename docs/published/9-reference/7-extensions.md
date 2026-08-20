---
title: extensions
---

# extensions

an extension is a TypeScript file that default-exports a function taking `g`, the glrs API. Bun imports `.ts` directly, so there is no build step, and `g` needs no imports: `g.z` is zod.

## discovery

| path | source |
| --- | --- |
| `<root>/.glrs/extensions/` | disk, Project |
| `<user config>/extensions/` | disk, User |
| bundled, when on | bundled |
| absolute paths in `extensions.load` | config |

`name.ts` or `name/index.ts`, walked in that order. the first claim on a name wins. `<user config>` is the directory named under [configuration](./8-configuration.md). one that throws on import or in its function costs only itself and says so at startup; `glrs doctor` resolves the list without running any of it.

## bundled

| name | package | default | provides |
| --- | --- | --- | --- |
| `builtins` | `@glrs-dev/glrs-ext-builtins` | on | the six file and shell tools, and every slash command |
| `ask-user` | `@glrs-dev/glrs-ext-ask-user` | off | `ask_user`, a multiple-choice question answered in the TUI |
| `web-fetch` | `@glrs-dev/glrs-ext-web-fetch` | off | `web_fetch`, a page as markdown, JavaScript rendered when Chrome is installed |
| `worktree` | `@glrs-dev/glrs-ext-worktree` | off | git worktrees, and `glrs wt` |

`extensions.load` names one by name or by package, `extensions.disable` wins over it, and a file on disk of the same name replaces it. taking `builtins` leaves the model with no tools unless yours registers them.

## api

| area | members |
| --- | --- |
| register | `tool` `command` `cli` `key` `flag` `on` |
| host | `root` `exec` `mode` `hasUI` `settings` `available` `setExtension` `inspect` `reload` `shutdown` `events.emit` `events.on` |
| turn | `send` `abort` `idle` `pending` `usage` `systemPrompt` `prompt` `clear` `compact` `model` `models` `setModel` `tools` `filterTools` `session` `setSessionName` `appendEntry` `entries` |
| draw | `print` `columns` `clip` `status` `footer` `activity` `markdown` `ui.capture` `ui.setInput` |

every signature: the generated **Extension API** page, built from `packages/glrs-coding-agent/src/public-extension-api.ts`. every payload: [events](./7-extensions.md).

a tool filter narrows what the model may call, from the next model call. every filter has to agree, so they can only narrow; `filterTools` returns `{ lift }`, which removes your own and nobody else's. a handler returning `undefined` changes nothing. a tool name already claimed is refused, and `/extensions` lists it as shadowed.

renderers run synchronously during a paint. `footer` returns `Line[]`, `activity` returns `Line[]` or null to keep glrs's own, `status` returns a string or null. a span marked `fill` takes a background, and one on a line pads it out to the terminal width.

```typescript
type Tone = "accent" | "highlight" | "muted" | "prompt" | "success" | "warning" | "danger";
type Span = {
  text: string;
  tone?: Tone;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fill?: boolean;
};
type Line = Span[];
```

## hosts

1. `g.mode` is `tui`, `print` or `cli`, and `hasUI` is true only in the TUI. `root`, `exec`, `columns`, `settings` and `available` answer in all three; `setExtension` returns `"not-allowed"` outside the TUI.
2. under `-p`: `ui.capture`, `models` and `setModel` throw; `send`, `ui.setInput`, `reload` and `setExtension` write a notice to stderr and do nothing; `print` goes to stderr too; `clear` is `"empty"` and `compact` is `"too-short"`; `session`, `setSessionName`, `appendEntry` and `entries` are stubs, a `-p` run having no session file; keys and flags register and never fire.
3. in a subcommand: `print` goes to stdout, undecorated. every member needing a session throws, naming itself and pointing at a slash command or a tool instead; `inspect` is empty.

## sdk

`@glrs-dev/glrs` exports `createAgentCore`, `createCodingAgent`, `createProviderRegistry` and `jsonSessionRepository` for embedding a session in another host: the generated **SDK** page, built from `packages/glrs-coding-agent/src/sdk.ts`. an extension imports `@glrs-dev/glrs/extension-api` instead.

# events

an extension observes and changes a turn through `g.on`.

## g.on

```typescript
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
| `agent_start` | `{ prompt }` | nothing |
| `agent_end` | `{ text }` | nothing |
| `before_agent_start` | `{ prompt, systemPrompt }` | a string replaces the prompt, `false` cancels the turn, an object replaces either field |
| `project_trust` | `{ root }` | `trusted`, `denied` or `deferred` |
| `session_before_compact` | `{ automatic, instruction? }` | `false` cancels it, an object supplies the summary or the instruction |
| `session_before_fork` | `{ id, at? }` | `false` cancels the fork |
| `session_before_switch` | `{ from, to }` | `false` cancels the switch |
| `session_shutdown` | `{ root }` | nothing, awaited before the process exits |

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

see also: [your first extension](../1-tutorials/2-first-extension.md), [events](./7-extensions.md)
