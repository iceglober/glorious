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
| `input` | `{ text }` | a string replaces what was typed; `false` swallows it |
| `turn_start` | `{ text }` | `false` cancels the turn |
| `turn_end` | `{ text }` | — |
| `tool_start` | `{ name, input }` | — |
| `tool_end` | `{ name, input, ok, result }` | — |

Async handlers are awaited. `session_start` completes before the first turn, so
an extension that fetches or reads on the way up has finished registering by the
time anything can call it. A handler that throws is reported and the turn
carries on.

### `g.exec(command, args?)`

Runs a shell command in the project root. Returns `{ output, stdout, ok }`;
`args` arrive as real positional parameters, so `$1` and `$@` mean what a script
author expects and nothing needs quoting to stay safe.

### `g.send(text, label?)` / `g.print(content, tone?)` / `g.ask(questions)`

Start a turn, write into the transcript, or ask the user with the same widget
the `ask_user` tool uses. Tones: `accent`, `highlight`, `muted`, `prompt`,
`success`, `warning`, `danger`.

`g.print` takes a string, or `Line[]` when you want it styled — that is how the
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
`reload()` re-reads skills, commands and sequences from disk.

### `g.prompt(text)`

Appends a line the model sees on every turn. It rides in the per-turn message,
never the system prompt, which has to stay byte-identical for the prompt cache.

### `g.status(render)` / `g.footer(render)`

`status` contributes a segment to the status line; return `null` for nothing.
`footer` draws rows above it; return `[]` for nothing. Both are called on every
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
