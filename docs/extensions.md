# Extensions

An extension is a TypeScript file that default-exports a function taking the
glorious API. It is how glorious grows: everything the core refuses to build —
custom tools, project-specific commands, hooks, status widgets — lives here.

```ts
// .glorious/extensions/git-branch.ts
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
| `.glorious/extensions/*.ts` | this project |
| `.glorious/extensions/<name>/index.ts` | this project, multi-file |
| `~/.config/agents/extensions/*.ts` | you, everywhere |
| bundled with glorious | shipped, enabled by default |

Because project files load first, `.glorious/extensions/web-fetch.ts` replaces
the bundled `web_fetch` rather than colliding with it.

Two extensions ship enabled: `web-fetch` (the `web_fetch` tool) and `builtins`
(`/help`, `/clear`, `/skills`, `/extensions`, `/reload`). **The core registers no
slash commands and no tools of its own** — everything glorious ships is written
against the API on this page. Shadow either by name, or delete them.

`/extensions` lists what loaded, what each one registered, and the file it came
from. An extension that fails to load says so in the transcript — loudly, not by
disappearing — and takes nothing else down with it.

## No approval prompt

Extensions run with your full permissions and there is no gate. That is
deliberate and it is the same bet the rest of glorious makes: an agent that can
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
`.glorious/commands/` — see `commands.md`. For one that runs a shell command and
then feeds its output to the model, write a sequence — see `sequences.md`.

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

**Be careful blocking a tool headlessly.** `g.ui.*` needs a person, so a gate
that asks for confirmation has to decide what to do when `g.hasUI` is false.
Refusing every `bash` in print mode makes `glorious -p` unusable — including the
run the agent uses to verify its own work, which will then retry until something
times out. Either allow the call when there is no UI, or narrow the gate to the
commands that actually warrant it:

```ts
g.on("tool_call", async ({ name, input }) => {
  if (name !== "bash") return;
  const command = String(input.command ?? "");
  if (!/rm -rf|force-push|drop table/iu.test(command)) return;   // narrow
  if (!g.hasUI) return `refused headlessly: ${command}`;         // and explicit
  if (!(await g.ui.confirm("Run this?", command))) return "you declined";
});
```

Async handlers are awaited. `session_start` completes before the first turn, so
an extension that fetches or reads on the way up has finished registering by the
time anything can call it. A handler that throws is reported and the turn
carries on.

### `g.exec(command, args?)`

Runs a shell command in the project root. Returns `{ output, stdout, ok }`;
`args` arrive as real positional parameters, so `$1` and `$@` mean what a script
author expects and nothing needs quoting to stay safe.

### `g.root`

The project root, absolute. Every relative path an extension resolves should
resolve against this, not `process.cwd()` — a sequence or a tool may have moved
the working directory.

### `g.ui`

Prompts, in the composer rather than over the transcript. All of them throw in
print mode, so guard on `g.hasUI` if the extension should also work headlessly.

```ts
const choice = await g.ui.select("Which branch?", ["main", "next"]);  // string | null
const sure   = await g.ui.confirm("Delete it?", "This cannot be undone");  // boolean
const name   = await g.ui.input("New session name");  // string | null
g.ui.setInput("git status");   // put text in the composer, ready to edit
```

`select` and `input` resolve to `null` when dismissed; `confirm` resolves
`false`. Dismissal is never mistaken for agreement.

### `g.send(text, options?)` / `g.print(content, tone?)` / `g.ask(questions)`

Start a turn, write into the transcript, or ask the user with the same widget
the `ask_user` tool uses. Tones: `accent`, `highlight`, `muted`, `prompt`,
`success`, `warning`, `danger`.

`g.send(text, { label, steer })` — `label` is what the transcript shows instead
of the text, which matters when the text is a 30k expansion nobody typed.
`steer: true` puts the message next in the queue rather than last; the running
turn is never interrupted by it.

`g.columns()` is the terminal width and `g.clip(text, n)` trims to it, counting what the terminal counts. `g.print` takes a string, or `Line[]` when you want it styled — that is how the
bundled `builtins` extension draws `/help`.

`g.ask` throws in print mode — there is nobody to answer.

### `g.inspect()` / `g.clear()` / `g.reload()`

`inspect()` returns what is loaded right now — `{ commands, sequences, skills,
extensions }`. Every listing glorious ships is a view over it and nothing more,
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
`reload()` re-reads skills, commands and sequences from disk.

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
extensions load, so `glorious --greet world` reaches yours; one nothing claims
is reported rather than ignored.

### Tools and models

```ts
g.tools()                       // what the model can call right now
g.setTools(["read", "grep"])    // restrict it; null lifts the restriction
g.model()                       // { label, provider, modelId, variant, context }
await g.models()                // the whole catalogue
await g.setModel("anthropic/claude-opus-5", "high")
```

`setTools` withholds rather than forbids, so there is nothing to argue with.
Between these and `tool_call`, both plan mode and the model picker are writable
as extensions.

### Turn and session

```ts
g.idle() · g.pending() · g.abort() · g.usage() · g.systemPrompt() · g.shutdown()
g.session()                     // { id, file, title, events }
g.setSessionName("refactor")
g.appendEntry("my-data", { … })  // persisted, never sent to the model
g.markdown((text) => text)      // transform assistant output, display only
g.events.emit(name, payload) · g.events.on(name, handler)   // extension to extension
```

### Run mode

`g.mode` is `"tui"` or `"print"`, and `g.hasUI` is false headlessly. Anything
that needs a person — `g.ui.*` — throws in print mode rather than hanging. Guard
on `g.hasUI` and your extension works in both.

### `g.prompt(text)`

Appends a line the model sees on every turn. It rides in the per-turn message,
never the system prompt, which has to stay byte-identical for the prompt cache.

### `g.status(render)` / `g.footer(render)` / `g.activity(render)`

`status` contributes a segment to the status line; return `null` for nothing.
`footer` draws rows above it; return `[]` for nothing.

`activity` replaces the row that says what the turn is doing — the phase, how
long it has been in it, the queued count and how to interrupt. Return `null` to
leave glorious's own.

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

Renderers return `Line[]`, glorious's own span structure:

```ts
type Span = { text: string; tone?: Tone; bold?: boolean; italic?: boolean; underline?: boolean };
type Line = Span[];
```

Never opentui types. That is deliberate — the renderer can be replaced without
breaking a single extension.

On a tool row, your renderer owns what the row says; glorious keeps the `✓`/`✗`
and the elapsed time, so those mean the same thing on every row whoever wrote
the tool.

## Testing one

```sh
glorious -p "use the count_todos tool on src and report the number"
```

Print mode loads extensions exactly as the TUI does, so this is the fastest way
to find out whether a tool is registered and callable.
