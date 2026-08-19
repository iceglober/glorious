---
title: Extensions
---

# Extensions

An extension is a TypeScript file that default-exports a function taking the
glrs API. It is how glrs grows: everything the core refuses to build —
custom tools, project-specific commands, hooks, status widgets — lives here.

```ts
// .glrs/extensions/git-branch.ts
export default function (g) {
  let branch = "";

  g.on("session_start", async () => {
    branch = (await g.exec("git branch --show-current")).stdout.trim();
  });

  g.status(() => (branch === "" ? null : `⎇ ${branch}`));

  g.tool({
    name: "stash_list",
    description: "List the git stash entries in this repository.",
    input: g.z.object({}),
    execute: async () => (await g.exec("git stash list")).stdout || "(no stashes)",
    renderCall: () => [[{ text: "reading the stash", tone: "accent" }]],
  });

  g.command("branch", {
    description: "Show the current branch",
    run: () => g.print(`on ${branch}`),
  });
}
```

No imports. Bun runs `.ts` directly, so there is no build step, and everything
you need arrives on `g` — including zod, as `g.z`. An extension that had to
resolve `zod` itself would work inside a project and fail from your home
directory, which is not a working extension.

## Where they live

Loaded in this order; the first file to claim a name wins.

| Path | Scope |
| --- | --- |
| `.glrs/extensions/*.ts` | this project |
| `.glrs/extensions/<name>/index.ts` | this project, multi-file |
| `~/.config/agents/extensions/*.ts` | you, everywhere |
| bundled with glrs | shipped, enabled by default |

Because project files load first, `.glrs/extensions/web-fetch.ts` replaces
the bundled `web_fetch` rather than colliding with it.

Two extensions ship enabled: `web-fetch` (the `web_fetch` tool) and `builtins`
(`/help`, `/clear`, `/skills`, `/extensions`, `/reload`). **The core registers no
slash commands and no tools of its own** — everything glrs ships is written
against the API on this page. Shadow either by name, or delete them.

`/extensions` lists what loaded, what each one registered, and the file it came
from. An extension that fails to load says so in the transcript — loudly, not by
disappearing — and takes nothing else down with it.

## No approval prompt

Extensions run with your full permissions and there is no gate. That is
deliberate and it is the same bet the rest of glrs makes: an agent that can
write files and run commands has already crossed the line a confirmation dialog
would pretend to defend. The honest thing is to say so, keep what loaded
visible, and let you use a container or a worktree when the blast radius matters.

Read a third-party extension before you install it. It is a program.

## The API

### `g.tool(spec)`

Registers a tool the model can call.

```ts
g.tool({
  name: "count_todos",
  description: "Count TODO comments under a path.",
  input: g.z.object({ path: g.z.string().describe("Directory to scan") }),
  async execute(input, signal) {
    const { stdout } = await g.exec(`rg -c TODO ${input.path} | wc -l`);
    return stdout.trim();
  },
  renderCall: (input) => [[{ text: `counting TODOs in ${input.path}` }]],
  renderResult: (result, ok) => [[{ text: ok ? `${result} found` : result }]],
});
```

**The first extension to claim a tool name keeps it**, the same rule the table
above states for file names. Extensions load project-first, so registering
`bash` in `.glrs/extensions/` replaces the one glrs ships — you do not
have to shadow the whole extension that provides it. A later registration of a
name already taken is refused and reported by `/extensions` as `shadowed`,
rather than silently winning or silently vanishing.

`execute` returns a string — that is what the model reads. Throwing is fine: it
becomes `ERROR: <message>`, which the model can read and recover from. Results
are capped at 30k characters, the same as every built-in tool.

`description` is paid for on every turn, in every session where the extension is
installed. Write it like a tool signature, not like documentation.

### `g.command(name, spec)`

Registers a slash command that runs your code. The model never sees it.

```ts
g.command("todo", {
  description: "Show open TODOs",
  run: async (args) => g.print((await g.exec(`rg -n TODO ${args || "."}`)).stdout),
});
```

For a command that should instead become a prompt, write a markdown file in
`.glrs/commands/` — see `commands.md`. For one that runs a shell command and
then feeds its output to the model, use `g.send` from an extension.

### `g.on(event, handler)`

| Event | Payload | Returning a value |
| --- | --- | --- |
| `session_start` | `{ root }` | — |
| `session_end` | `{ root }` | awaited, so a flush completes before teardown |
| `input` | `{ text }` | a string replaces what was typed; `false` swallows it |
| `user_bash` | `{ command }` | — |
| `before_request` | `{ prompt, messages }` | a string is appended to this turn's message |
| `turn_start` | `{ text }` | `false` cancels the turn |
| `message` | `{ kind, text }` | — (streaming deltas) |
| `tool_call` | `{ name, input }` | **`false` or a string blocks the call** |
| `tool_start` | `{ name, input }` | — |
| `tool_end` | `{ name, input, ok, result }` | **a string replaces what the model is told** |
| `turn_end` | `{ text }` | — |
| `idle` | — | — |
| `model_select` | `{ model, variant }` | — |
| `compact` | `{ dropped, kept, automatic }` | — |
| `usage` | `{ input, output, cached, cost, contextTokens }` | — |
| `reasoning` | `{ text, elapsedMs }` | — |
| `error` | `{ message }` | — |

`tool_call` and `tool_end` are the powerful pair. A read-only mode is the whole
of this:

```ts
export default function (g) {
  const mutating = new Set(["write", "edit", "bash"]);
  g.on("tool_call", ({ name }) => {
    if (mutating.has(name)) return `${name} is unavailable: this session is read-only.`;
  });
  g.status(() => "🔒 read-only");
}
```

The model is told why, by name, so it chooses something else instead of seeing
an unexplained failure. Withholding beats instructing — a blocked tool cannot be
talked into running.

**Be careful blocking a tool headlessly.** `g.ui.capture` needs a person, so a gate
that asks for confirmation has to decide what to do when `g.hasUI` is false.
Refusing every `bash` in print mode makes `glrs -p` unusable — including the
run the agent uses to verify its own work, which will then retry until something
times out. Either allow the call when there is no UI, or narrow the gate to the
commands that actually warrant it:

```ts
g.on("tool_call", async ({ name, input }) => {
  if (name !== "bash") return;
  const command = String(input.command ?? "");
  if (!/rm -rf|force-push|drop table/iu.test(command)) return;   // narrow
  if (!g.hasUI) return `refused headlessly: ${command}`;         // and explicit
  if (!(await confirm(g, "Run this?", command))) return "you declined";   // your own, on g.ui.capture
});
```

Async handlers are awaited. `session_start` completes before the first turn, so
an extension that fetches or reads on the way up has finished registering by the
time anything can call it. A handler that throws is reported and the turn
carries on.

### `g.exec(command, args?)`

Runs a shell command in the project root. Returns
`{ output, stdout, stderr, code, ok }`;
`args` arrive as real positional parameters, so `$1` and `$@` mean what a script
author expects and nothing needs quoting to stay safe.

`code` and `stderr` are there because `ok` collapsed every failure into one bit:
exit 1 (the linter found problems) and exit 127 (the linter is not installed)
are opposite situations and used to be indistinguishable.

```ts
const { code, stderr } = await g.exec("eslint .");
if (code === 127) g.print("eslint is not installed", "warning");
else if (code !== 0) g.print(stderr, "danger");
```

### `g.root`

The project root, absolute. Every relative path an extension resolves should
resolve against this, not `process.cwd()` — an extension or tool may have moved
the working directory.

### `g.ui.capture(spec)`

Take over the composer area: draw your own lines there and receive every key,
until you close.

```ts
g.command("branch", {
  description: "Switch branch",
  run: async () => {
    const names = (await g.exec("git branch --format=%(refname:short)")).stdout.trim().split("\n");
    let at = 0;
    const held = g.ui.capture({
      render: () => names.map((name, index): Line => [
        { text: index === at ? "› " : "  ", tone: "accent" },
        { text: name, bold: index === at },
      ]),
      onKey: (key) => {
        if (key.key === "up") at = (at + names.length - 1) % names.length;
        if (key.key === "down") at = (at + 1) % names.length;
        if (key.key === "escape") held.close();
        if (key.key === "return") {
          held.close();
          void g.exec(`git switch ${names[at]}`);
        }
      },
    });
  },
});
```

`render` is called on every key and on resize; `onKey` sees every keypress and
nothing else does. `close()` gives the composer back, and is safe to call twice.
A `Key` is `{ key, ctrl, shift, text }` — `key` is a name like `"return"` or
`"escape"`, `text` is what the key would type and is empty for control keys.

**This is the only input primitive, deliberately.** There used to be `g.ask`,
`g.ui.select`, `g.ui.confirm` and `g.ui.input`, which meant the core had an
opinion about what a question looks like — a 234-line question widget lived in
the renderer for the sake of one tool, and the "generic" helpers around it
worked by parsing the JSON that tool returned to the model. A coding agent's
core does not need to know what asking is.

The bundled `ask-user` extension is a full question widget — options, a cursor,
free-text notes, several questions in a row — written against nothing but
`g.ui.capture`. Read `packages/extensions/ask-user/src/index.ts`; yours starts the same way and is
not competing with anything privileged.

`g.ui.capture` throws in print mode, where there is no composer. Guard on
`g.hasUI`.

`g.ui.setInput("git status")` puts text in the composer, ready to edit.

### `g.send(text, options?)` / `g.print(content, tone?)`

Start a turn, or write into the transcript. Tones: `accent`, `highlight`,
`muted`, `prompt`, `success`, `warning`, `danger`.

`g.send(text, { label, steer })` — `label` is what the transcript shows instead
of the text, which matters when the text is a 30k expansion nobody typed.
`steer: true` puts the message next in the queue rather than last; the running
turn is never interrupted by it.

`g.columns()` is the terminal width and `g.clip(text, n)` trims to it, counting what the terminal counts. `g.print` takes a string, or `Line[]` when you want it styled — that is how the
bundled `builtins` extension draws `/help`.

`g.ask` throws in print mode — there is nobody to answer.

### `g.inspect()` / `g.clear()` / `g.reload()`

`inspect()` returns what is loaded right now — `{ commands, skills,
extensions }`. Every listing glrs ships is a view over it and nothing more,
which is why none of them are built in:

```ts
g.command("skills", {
  description: "List available skills",
  run: () => {
    for (const skill of g.inspect().skills) g.print(`${skill.name}  ${skill.description}`);
  },
});
```

`clear()` drops the conversation the model replays, leaving the transcript
alone, and returns `"cleared"`, `"busy"` (a turn is running) or `"empty"`.
`compact({ instruction?, keep? })` summarises the older part instead of
discarding it, so a session can outlive its window.
`reload()` re-reads skills, commands, and extensions from disk.

### Tokens, cache and cost

`usage` fires once per model call — a turn running three tools reports four
times. `cached` is what the provider served from its prompt cache instead of
reprocessing, so `cached / input` is the hit rate.

```ts
g.on("usage", ({ input, output, cached, cost, contextTokens }) => {
  const hit = input > 0 ? Math.round((cached / input) * 100) : 0;
  g.print(`in ${input} out ${output} · ${hit}% cached · $${(cost ?? 0).toFixed(4)}`);
});
```

`g.usage()` gives the current picture and the session total:

```ts
const { tokens, context, last, total } = g.usage();
// tokens  — context size the provider last reported
// context — the model's window
// last    — { input, output, cached, cost } for the most recent call
// total   — the same, summed across the session, plus `steps`
```

`total` is summed from the session's own events, so a resumed session reports
what the whole session cost rather than what it has cost since reopening — and
a `/clear` does not reset it, because clearing drops what the model replays, not
what the run spent.

All of it works under `-p` as well as in the TUI, including prices.

### Keys and flags

```ts
g.key({ key: "b", ctrl: true, description: "Toggle", run: () => g.print("hi") });
g.flag("greet", { description: "Say hello", run: (value) => g.print(value) });
```

A binding runs before the composer sees the key. A flag is claimed after
extensions load, so `glrs --greet world` reaches yours; one nothing claims
is reported rather than ignored.

### Tools and models

```ts
g.tools()                              // what the model can call right now
const held = g.filterTools((n) => n !== "bash")   // narrow it; held.lift() undoes yours
g.model()                              // { label, provider, modelId, variant, context }
await g.models()                       // the whole catalogue
await g.setModel("anthropic/claude-opus-5", "high")
```

`filterTools` withholds rather than forbids, so there is nothing to argue with —
a tool that is absent cannot be talked into being used. **Every extension's
filter has to agree**, so restrictions compose and can only narrow:

```ts
// two extensions, installed independently, neither aware of the other
readOnly.filterTools((name) => !["write", "edit"].includes(name));
noShell.filterTools((name) => name !== "bash");
// the model is left with read, grep, glob — both restrictions hold
```

This replaced `setTools(names)`, which set one global list: the second extension
to call it silently undid the first, and neither could see the other.

A filter is a predicate, applied every time the model is asked what it can
call — not a list of names resolved once when you registered it. So a tool
registered by an extension that loads after yours is still judged by your
filter rather than missed by it, and load order does not decide what the model
can see.

`filterTools` and `tool_call` are not the same thing. A filter **removes** the
tool, so the model never sees it. A `tool_call` handler **refuses** a call and
tells the model why, which is what you want when the answer depends on the
arguments. Between them, plan mode and the model picker are both writable as
extensions.

### Turn and session

```ts
g.idle() · g.pending() · g.abort() · g.usage() · g.systemPrompt() · g.shutdown()
g.session()                     // { id, file, title, events }
g.setSessionName("refactor")
g.appendEntry("my-data", { … })  // persisted, never sent to the model
g.entries("my-data")            // …and read back, oldest first, across a --resume
g.markdown((text) => text)      // transform assistant output, display only
g.events.emit(name, payload) · g.events.on(name, handler)   // extension to extension
```

`appendEntry` had no counterpart, so an extension could write to the session
file and never read it back — the only way to recover your own data was to open
`session().file` and parse it yourself. `entries` returns what this session has
recorded under that type, including what earlier turns wrote before a
`--resume`.

`g.print(content, tone)` applies `tone` to `Line[]` as well as to strings: spans
that name their own tone keep it, and the rest take the one you passed. It used
to be dropped silently for anything but a string.

### Run mode

`g.mode` is `"tui"` or `"print"`, and `g.hasUI` is false headlessly. Anything
that needs a person — `g.ui.capture` — throws in print mode rather than hanging. Guard
on `g.hasUI` and your extension works in both.

### `g.prompt(text)`

Appends a line the model sees on every turn. It rides in the per-turn message,
never the system prompt, which has to stay byte-identical for the prompt cache.

### `g.status(render)` / `g.footer(render)` / `g.activity(render)`

`status` contributes a segment to the status line; return `null` for nothing.
`footer` draws rows above it; return `[]` for nothing.

`activity` replaces the row that says what the turn is doing — the phase, how
long it has been in it, the queued count and how to interrupt. Return `null` to
leave glrs's own.

```ts
g.activity(({ busy, queued, phase, columns }) =>
  !busy ? null : [[
    { text: "▸ ", tone: "success" },
    { text: phase ? `${phase.name} ${(phase.ms / 1000).toFixed(1)}s` : "working" },
    { text: queued > 0 ? `  (+${queued} waiting)` : "", tone: "warning" },
  ]],
);
```

The first extension to return lines wins, so a project overrides a personal one
the same way it overrides a command. Keep it to `columns` wide — nothing clips
it for you. Both are called on every
paint, so keep them cheap and synchronous — do the work in a hook and render
from a variable, the way the `git-branch` example above does. One that throws
loses its contribution for that frame and nothing else.

## Rendering

Renderers return `Line[]`, glrs's own span structure:

```ts
type Span = { text: string; tone?: Tone; bold?: boolean; italic?: boolean; underline?: boolean };
type Line = Span[];
```

Never opentui types. That is deliberate — the renderer can be replaced without
breaking a single extension.

A tool row is one line — what was called, what came back, how long it took:

```
  ✓ read    v2/render.ts · 432 lines                            8ms
  ✓ grep    "toolRow" in v2/ · 2 matches                      124ms
  ✗ edit    v2/render.ts                                       24ms
    old_string not found in file
  ✓ bash    bun test --timeout 60000 · 308 pass               23.8s
  └ 4 calls · 24.0s · 1 failed
```

The tool name has a fixed column, so calls line up without any row knowing about
the others. What comes back is a **summary**, not a tail: `432 lines`, not the
last three lines of the file. Only a failure earns a second line, carrying the
reason. The footer closes a run of calls — everything between two things the
model said — and is skipped for a single call, where the row already says it.

`renderResult` is where your tool describes its own result. **Its first line
becomes the row's summary**; return more lines and they hang under the row:

```ts
g.tool({
  name: "count_todos",
  // …
  renderResult: (result, ok) => [[{ text: ok ? `${result} found` : result }]],
});
```

There is deliberately no second mechanism for this — one seam, so the row and
anything else reading a result cannot drift apart. glrs keeps the `✓`/`✗`,
the call, and the elapsed time, so those mean the same thing on every row
whoever wrote the tool. Print mode renders the identical row and the identical
footer to stderr.

## Testing one

```sh
glrs -p "use the count_todos tool on src and report the number"
```

Print mode loads extensions exactly as the TUI does, so this is the fastest way
to find out whether a tool is registered and callable.
