---
title: extensions
---

# extensions

an extension is a TypeScript module that default-exports a function receiving
the glrs API.

```ts
// .glrs/extensions/git-branch.ts
export default function (g) {
  let branch = "";

  g.on("session_start", async () => {
    branch = (await g.exec("git branch --show-current")).stdout.trim();
  });

  g.status(() => (branch ? `⎇ ${branch}` : null));

  g.tool({
    name: "stash_list",
    description: "List git stash entries.",
    input: g.z.object({}),
    execute: async () => (await g.exec("git stash list")).stdout || "(no stashes)",
  });
}
```

Bun runs `.ts` directly. `g.z` provides zod, so a one-file extension needs no
imports or build step.

## locations

loaded in order; first name wins:

| path | scope |
| --- | --- |
| `.glrs/extensions/*.ts` | Project |
| `.glrs/extensions/<name>/index.ts` | Project, multi-file |
| `<User>/extensions/*.ts` | User |
| `<User>/extensions/<name>/index.ts` | User, multi-file |
| `extensions.load` paths | configured |
| shipped extensions | bundled |

relative config paths resolve from the config file. a directory entry point is
`index.ts`.

an extension that fails to import or initialize is reported without stopping
other extensions. `/extensions` shows what loaded and what each registered.

## shipped extensions

| name | provides | default |
| --- | --- | --- |
| `builtins` | six machine tools and all bundled slash commands | on |
| `web-fetch` | `web_fetch` | off |
| `ask-user` | `ask_user` in the TUI | off |

```json
{
  "extensions": {
    "load": ["web-fetch"],
    "disable": ["ask-user"]
  }
}
```

`disable` wins over `load`. lists add up across config scopes. a Project file can
shadow a shipped extension by filename or replace one tool by registering the
same tool name.

```text
/extensions
/extensions enable web-fetch
/extensions disable ask-user
```

recording enable/disable choices requires `agentConfigAllowlist`; see
[configuration](./3-configuration.md).

## permissions

extensions run with the full permissions of glrs. there is no approval prompt.
read third-party code before installing it.

## tools

```ts
export default function (g) {
  g.tool({
    name: "count_todos",
    description: "Count TODO comments under a path.",
    input: g.z.object({ path: g.z.string() }),
    async execute({ path }, signal) {
      return (await g.exec(`rg -c TODO ${path}`)).stdout;
    },
    renderCall: ({ path }) => [[{ text: `counting ${path}`, tone: "accent" }]],
    renderResult: (result, ok) => [[{ text: ok ? result : `failed: ${result}` }]],
  });
}
```

`execute` returns the string the model reads. throws become `ERROR:` results.
results are capped at 30,000 characters. descriptions are sent on every model
call; keep them short and operational.

first tool registration wins. a refused duplicate appears as `shadowed` in
`/extensions`.

## commands, keys, and flags

```ts
export default function (g) {
  g.command("branch", {
    description: "show the current branch",
    run: async () => g.print((await g.exec("git branch --show-current")).stdout),
  });

  g.key({ key: "b", ctrl: true, description: "show branch", run: () => {} });
  g.flag("greet", { description: "print a greeting", run: (value) => g.print(value) });
}
```

commands and key handlers may be async. extension flags are claimed after
extensions load; unknown flags are errors.

## hooks

```ts
g.on("tool_call", ({ name }) => {
  if (name === "bash") return "bash is disabled for this session";
});

g.on("tool_end", ({ result }) => result.replaceAll("secret", "[redacted]"));
```

`tool_call` can block a call with `false` or a reason string. `tool_end` can
replace what the model reads. other hooks can rewrite input, context, and
provider requests.

see [lifecycle](./lifecycle.md) for every event, payload, and return value.

## shell and paths

```ts
const result = await g.exec("git status --short");
// { output, stdout, stderr, code, ok }
```

`g.root` is the absolute Project root. resolve relative paths from it, not
`process.cwd()`.

## tui capture

`g.ui.capture()` temporarily owns the composer area and every key:

```ts
const held = g.ui.capture({
  render: () => [[{ text: "enter to close" }]],
  onKey: (key) => {
    if (key.key === "return" || key.key === "escape") held.close();
  },
});
```

it is the only interactive input primitive. guard with `g.hasUI`; capture is
unavailable in print mode. `g.ui.setInput(text)` fills the normal composer.

## messages and state

| API | purpose |
| --- | --- |
| `g.send(text, options)` | start or queue a turn |
| `g.print(content, tone)` | write to the transcript |
| `g.inspect()` | list loaded commands, skills, and extensions |
| `g.reload()` | reload disk resources plus extension/tool config |
| `g.clear()` | clear model context |
| `g.compact()` | summarize older context |
| `g.session()` | current session metadata |
| `g.appendEntry()` / `g.entries()` | persist extension data in the session |
| `g.events.emit()` / `g.events.on()` | extension-to-extension events |

`g.mode` is `tui` or `print`. `g.idle()`, `g.pending()`, `g.abort()`, and
`g.shutdown()` control the running host.

## tools and models

```ts
g.tools();
const filter = g.filterTools((name) => name !== "bash");
filter.lift();

g.model();
await g.models();
await g.setModel("anthropic/claude-opus-5", "high");
```

all active tool filters must agree. filters remove tools from the model schema;
`tool_call` blocks a call the model already made.

## prompt and UI

| API | contribution |
| --- | --- |
| `g.prompt(text)` | per-turn model context |
| `g.status(render)` | status-line segment |
| `g.footer(render)` | rows above the status line |
| `g.activity(render)` | running activity row |
| `g.markdown(transform)` | assistant display transform |

render functions return `Line[]`, arrays of spans:

```ts
type Span = {
  text: string;
  tone?: "accent" | "highlight" | "muted" | "prompt" | "success" | "warning" | "danger";
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
};
type Line = Span[];
```

renderers are synchronous and called during paint. do work in a hook and render
from stored state.

## test

```sh
glrs -p "use count_todos on src"
```

print mode loads extensions the same way as the TUI. use the generated
**Extension API** reference for exact TypeScript signatures.
