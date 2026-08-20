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

`name.ts` or `name/index.ts`, walked in that order. the first claim on a name wins. `<user config>` is the directory named under [configuration](./5-configuration.md). one that throws on import or in its function costs only itself and says so at startup; `glrs doctor` resolves the list without running any of it.

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

every signature: the generated **Extension API** page, built from `packages/glrs-coding-agent/src/public-extension-api.ts`. every payload: [events](./8-events.md).

a tool filter narrows what the model may call, from the next model call. every filter has to agree, so they can only narrow; `filterTools` returns `{ lift }`, which removes your own and nobody else's. a handler returning `undefined` changes nothing. a tool name already claimed is refused, and `/extensions` lists it as shadowed.

renderers run synchronously during a paint. `footer` returns `Line[]`, `activity` returns `Line[]` or null to keep glrs's own, `status` returns a string or null. a span marked `fill` takes a background, and one on a line pads it out to the terminal width.

```ts
type Tone = "accent" | "highlight" | "muted" | "prompt" | "success" | "warning" | "danger";
type Span = { text: string; tone?: Tone; bold?: boolean; italic?: boolean; underline?: boolean; fill?: boolean };
type Line = Span[];
```

## hosts

1. `g.mode` is `tui`, `print` or `cli`, and `hasUI` is true only in the TUI. `root`, `exec`, `columns`, `settings` and `available` answer in all three; `setExtension` returns `"not-allowed"` outside the TUI.
2. under `-p`: `ui.capture`, `models` and `setModel` throw; `send`, `ui.setInput`, `reload` and `setExtension` write a notice to stderr and do nothing; `print` goes to stderr too; `clear` is `"empty"` and `compact` is `"too-short"`; `session`, `setSessionName`, `appendEntry` and `entries` are stubs, a `-p` run having no session file; keys and flags register and never fire.
3. in a subcommand: `print` goes to stdout, undecorated. every member needing a session throws, naming itself and pointing at a slash command or a tool instead; `inspect` is empty.

## sdk

`@glrs-dev/glrs` exports `createAgentCore`, `createCodingAgent`, `createProviderRegistry` and `jsonSessionRepository` for embedding a session in another host: the generated **SDK** page, built from `packages/glrs-coding-agent/src/sdk.ts`. an extension imports `@glrs-dev/glrs/extension-api` instead.
