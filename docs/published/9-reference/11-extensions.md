---
title: extensions
---

# extensions

an extension is a TypeScript file that default-exports a function taking `g`, the glrs API. Bun imports `.ts` directly, so there is no build step, and `g` needs no imports: `g.z` is zod.

## discovery

| path | source |
| --- | --- |
| `<project root>/.glrs/extensions/` | disk, Project |
| `<user config>/extensions/` | disk, User |
| bundled, when on | bundled |
| absolute paths in `extensions.load` | config |

`name.ts` or `name/index.ts`, walked in that order. the first claim on a name wins. `<user config>` is the directory named under [configuration](./14-configuration.md). one that throws on import or in its function costs only itself and says so at startup; `glrs doctor` resolves the list without running any of it.

## first-party extensions

| name | package | provides |
| --- | --- | --- |
| `builtins` | `@glrs-dev/glrs-ext-builtins` | the six file and shell tools, and every slash command |
| `model-picker` | `@glrs-dev/glrs-ext-model-picker` | `/model`, and the picker that opens when no model is set |
| `ask-user` | `@glrs-dev/glrs-ext-ask-user` | `ask_user`, a multiple-choice question answered in the TUI |
| `web-fetch` | `@glrs-dev/glrs-ext-web-fetch` | `web_fetch`, a page as markdown, JavaScript rendered when Chrome is installed |
| `worktree` | `@glrs-dev/glrs-ext-worktree` | git worktrees, and `glrs wt` |

`extensions.load` names one by name or by package, `extensions.disable` wins over it, and a file on disk of the same name replaces it. taking `builtins` leaves the model with no tools unless yours registers them. taking `model-picker` leaves a session that started without a model with no way to choose one in the TUI: [models](./4-models.md).

## api

| area | members |
| --- | --- |
| register | `tool` `command` `cli` `key` `flag` `on` |
| host | `root` `exec` `mode` `hasUI` `settings` `available` `setExtension` `inspect` `reload` `shutdown` `events.emit` `events.on` |
| turn | `send` `abort` `idle` `pending` `usage` `systemPrompt` `prompt` `clear` `compact` `model` `models` `setModel` `rememberModel` `setThinkingLevel` `tools` `filterTools` `session` `setSessionName` `appendEntry` `entries` |
| draw | `print` `columns` `clip` `status` `footer` `activity` `markdown` `ui.capture` `ui.setInput` |

every signature: the generated **Extension API** page, built from `packages/glrs-coding-agent/src/public-extension-api.ts`. every payload: [events](./12-events.md).

`model()` returns null when nothing has been chosen: a session opens before a
model exists. `setModel` switches for the session, `rememberModel` writes the
active one into the project config and returns `"not-allowed"` unless
`agentConfigAllowlist` names `model`. every `ModelInfo`, from `model()` and from
`models()` alike, carries `missing`: the variables or config keys glrs could not
find for that provider, empty when it found them all.

```typescript
const chosen = g.model();
if (chosen === null) g.print("nothing chosen yet");
else if (chosen.missing.length > 0) g.print(`set ${chosen.missing.join(", ")}`);
```

`missing` reads the environment and config and nothing else, so empty is not a
promise a call will succeed: [models](./4-models.md).

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

`g.mode` is `tui`, `print` or `cli`. `hasUI` is true only in the TUI.

- **everywhere**: `root`, `exec`, `columns`, `settings`, `available`, `tool`, `command`, `cli`, `on`.
- **`-p`**: `ui.capture`, `models` and `setModel` throw. `model()` is never null and `rememberModel` returns `"already"`, a one-shot run taking its model from the environment or the config already on disk. `send`, `ui.setInput`, `reload` and `setExtension` write a notice to stderr and do nothing. `print` goes to stderr. `clear` returns `"empty"`, `compact` returns `"too-short"`. `session`, `setSessionName`, `appendEntry` and `entries` are stubs, a `-p` run having no session file. keys and flags register and never fire.
- **subcommand**: `print` goes to stdout, undecorated. `inspect` is empty. every member needing a session throws, naming itself.

## sdk

`@glrs-dev/glrs` exports `createAgentCore`, `createCodingAgent`, `createProviderRegistry` and `jsonSessionRepository` for embedding a session in another host: the generated **SDK** page, built from `packages/glrs-coding-agent/src/sdk.ts`. an extension imports `@glrs-dev/glrs/extension-api` instead.

see also: [your first extension](../1-tutorials/2-first-extension.md), [events](./12-events.md)
