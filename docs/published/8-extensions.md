---
title: extensions
---

# extensions

an extension is a TypeScript file that default-exports a function taking the glrs
API object. drop it in `.glrs/extensions/` and it loads at startup.

```ts
// .glrs/extensions/branch.ts
import type { Extension } from "@glrs-dev/glrs/extension-api";

const extension: Extension = (g) => {
  let branch = "";

  g.on("session_start", async (): Promise<undefined> => {
    branch = (await g.exec("git branch --show-current")).stdout.trim();
  });

  g.status(() => (branch === "" ? null : `⎇ ${branch}`));

  g.tool({
    name: "stash_list",
    description: "List the git stash entries in this repository.",
    input: g.z.object({}),
    execute: async () => (await g.exec("git stash list")).stdout || "(no stashes)",
    renderCall: () => [[{ text: "git stash list", tone: "muted" }]],
  });

  g.cli("branch", {
    description: "Print the current git branch",
    run: async () => g.print((await g.exec("git branch --show-current")).stdout.trim()),
  });
};

export default extension;
```

Bun runs `.ts` directly, so there is no build step, and the `import type` above
is erased before the file executes, an extension needs no imports at all, and
the only thing it depends on at runtime is `g`. zod arrives as `g.z` rather than
being imported: an extension in your User config directory has no `node_modules`
to resolve zod from, and one that works in a project but not in your home
directory is not a working extension.

for types, `@glrs-dev/glrs/extension-api` exports what you write against,
`Glrs`, `Extension`, `ToolSpec`, `Line`, `Tone`, `EventPayload` and the rest,
and `@glrs-dev/glrs` re-exports `Extension` beside the SDK entry. both are
type-only here.

the return type on the `session_start` handler is not decoration. a handler
returns a verdict or `undefined`, never `void`, so that `false` from `tool_call`
and a string from `before_request` mean one thing each; an arrow that returns
nothing infers `void` and is rejected until its type is said out loud.

## where they come from

extensions are collected in this order, and the first file to claim a name keeps
it:

| where | scope |
| --- | --- |
| `<root>/.glrs/extensions/*.ts` | Project |
| `<root>/.glrs/extensions/<name>/index.ts` | Project, multi-file |
| `<User>/extensions/*.ts` | User |
| `<User>/extensions/<name>/index.ts` | User, multi-file |
| first-party extensions that are on | bundled |
| absolute paths named in `extensions.load` | configured |

`foo.ts` and `foo/index.ts` are both one extension named `foo`; the directory
form is where a `package.json` with dependencies of its own would sit. disk is
walked before anything shipped, which is what makes shadowing work: a file called
`web-fetch.ts` replaces the bundled `web-fetch` outright.

shadowing `builtins` is a larger act than it looks, and glrs interrupts to say
so, `builtins.ts shadows the extension that provides bash, read, write, edit,
grep, glob and every slash command, the model has no tools unless yours
registers them`. everything else is shadowed in silence, as intended.

`extensions.load` takes bundled names, package specifiers such as
`@glrs-dev/glrs-ext-worktree`, and paths. `./` and `../` are resolved against the
config file that declared them, while it is still known which of the three files
that was; `~/` is resolved against your home directory. only the prefixes that
are unambiguously a path are touched, so a bare relative name is read as a name
and fails with `no extension by that name is bundled or on disk, glrs ships
ask-user, builtins, worktree, web-fetch`. `extensions.disable` beats everything,
in any config scope, the two lists are unioned across Project-User, Project and
User, so a name disabled anywhere stays disabled.

an extension that throws while importing or initializing costs only itself; the
message is printed and the session continues. `/extensions` lists what loaded,
where each came from, and what each registered.

## what ships in the box

| name | package | default | registers |
| --- | --- | --- | --- |
| `builtins` | `@glrs-dev/glrs-ext-builtins` | on | `bash`, `read`, `write`, `edit`, `grep`, `glob`, and `/help`, `/skills`, `/extensions`, `/clear`, `/reload`, `/compact`, `/fork`, `/session` |
| `ask-user` | `@glrs-dev/glrs-ext-ask-user` | off | `ask_user` and the prompt line that tells the model when to use it |
| `web-fetch` | `@glrs-dev/glrs-ext-web-fetch` | off | `web_fetch` |
| `worktree` | `@glrs-dev/glrs-ext-worktree` | off | `glrs wt`, `/wt`, a per-turn prompt line, and a bundled skill |

`builtins` defaults on because it carries the tools the agent cannot work
without. none of the four is built in: the core registers no tools and no
commands at all, and every one of them arrives through the same API this page
describes, which is the point, and [how glrs works](./9-internals.md) says why.

`ask-user` registers nothing unless `g.hasUI`, because `ui.capture` throws
headlessly and a registered `ask_user` would hang the model on a question nobody
can answer. `worktree` ships a skill, as any extension may: the `skills/` folder
beside an entry point joins the skill roots, worked out from the load plan rather
than by running anything.

## turning one on

```json
{
  "extensions": {
    "load": ["worktree", "web-fetch"],
    "disable": ["ask-user"]
  }
}
```

hand-editing is the default and the only route that always works. the two other
routes end at the same writer, and neither may use it unless
`"agentConfigAllowlist": ["extensions"]` says glrs may write config at all:
`/extensions enable worktree` from the composer, described in
[commands, skills and rules](./7-commands.md), and `g.setExtension(name, on)`,
which the agent reaches through the `configure_extension` tool, and only to
record an answer you gave.

while a first-party extension is undecided, named in neither list, the per-turn
preamble says it is available; the offer stops once every one has been decided,
because an agent that keeps offering something you already declined is worse than
one that never offered. without the allowlist `setExtension` answers
`not-allowed` and the preamble tells the model to hand you the line to add
rather than to try.

either way, a change applies on the next `/reload` or restart.

## the API

44 members, declared once in `glrs-core` and implemented by the agent rather than
re-declared, so the type cannot drift from the object you are handed.

**registering**

| member | what it does |
| --- | --- |
| `g.tool(spec)` | a tool the model can call. first claim on a name wins; a refused duplicate shows as `shadowed` in `/extensions` |
| `g.command(name, spec)` | a slash command |
| `g.cli(name, spec)` | a subcommand of the executable |
| `g.key(spec)` | a keybinding. fires only when the composer has focus and nothing has captured it |
| `g.flag(name, spec)` | a `--name value` flag |
| `g.on(event, handler)` | a lifecycle event. [how glrs works](./9-internals.md) lists all twenty and what returning a value does |

a tool's `execute` returns the string the model reads; a throw becomes an
`ERROR:` result. results are capped at 30,000 characters. `renderCall` and
`renderResult` replace the transcript row; omit either and glrs draws its usual
one.

tool names and subcommand names are first-claimed-first-kept, and since disk is
walked before anything shipped, that is what lets a project replace one. slash
commands are the exception, and they split: the listing keeps the first
registration, so `/help` shows that one's description, while the runner is a map
keyed by name and the last registration is what actually runs. two extensions
claiming `/deploy` will disagree with each other about which of them you invoked.

**taking part in the conversation**

| member | what it does |
| --- | --- |
| `g.send(text, options)` | start a turn. `{ steer: true }` joins the turn already running at its next step boundary, so the model reads it before choosing its next action; without it the message waits for the turn to finish. `{ label }` is what the transcript shows instead of the text |
| `g.print(content, tone)` | write to the transcript. `Line[]` for styled output, a string for plain; a `tone` passed with lines is the default the spans may override |
| `g.markdown(transform)` | rewrite assistant markdown before it is drawn. display only |
| `g.prompt(text)` | a line in the per-turn preamble the model reads. pass a function to have it rendered fresh each turn; return `""` to say nothing this turn |
| `g.status(render)` | a segment of the status line, or `null` |
| `g.footer(render)` | rows above the status line |
| `g.activity(render)` | replace the activity row. first extension to return lines wins; return `null` to leave glrs's own |

renderers run synchronously during paint, on a 100 ms tick, so do the work in a
hook and render from what you stored. one that throws loses its contribution for
that frame and nothing else.

**reading state**

| member | what it does |
| --- | --- |
| `g.root` | the absolute project root. resolve paths against it, not `process.cwd()` |
| `g.settings()` | this session's merged `toolTimeoutMs`, `steeringMode`, `followUpMode`. provider blocks are absent, they hold API keys |
| `g.inspect()` | what is loaded: commands, skills, extensions, keys, flags |
| `g.tools()` | tool names the model can currently call |
| `g.model()` | the model in force, with its context window and variants |
| `g.models()` | every model the catalogue carries, credentials or not, the list a model picker would be built from |
| `g.usage()` | the context size the provider last reported, and the session's totals: input, output, cached, cost, steps |
| `g.session()` | id, file on disk, title, event count |
| `g.entries(type)` | everything this session recorded under `type`, including before a `--resume` |
| `g.systemPrompt()` | the system prompt exactly as the model receives it |
| `g.available()` | first-party extensions and whether each is on, off, or undecided |
| `g.mode` / `g.hasUI` | which host this is; `hasUI` is true only in the TUI |
| `g.columns()` / `g.clip(text, limit)` | terminal width, and clipping to it by graphemes rather than characters |
| `g.idle()` / `g.pending()` | whether anything is running, and how many turns are waiting behind it |

**acting**

| member | what it does |
| --- | --- |
| `g.exec(command, args)` | run a shell command in the project root; returns `{ output, stdout, stderr, code, ok }` |
| `g.setModel(label, variant)` | switch model as `"provider/model-id"`, from the next turn |
| `g.filterTools(keep)` | narrow what the model may call, from the next turn |
| `g.clear()` | drop the conversation the model replays; the transcript stays |
| `g.compact(options)` | summarise the older part of the conversation and carry the brief forward |
| `g.reload()` | re-read extensions, skills and commands from disk |
| `g.abort()` | interrupt the running turn |
| `g.shutdown()` | quit glrs |
| `g.setSessionName(title)` | rename the session, as the resume picker shows it |
| `g.appendEntry(type, data)` | persist your own data in the session file. never sent to the model |
| `g.events.emit(name, payload)` / `g.events.on(name, handler)` | a bus for extensions to talk to each other |
| `g.ui.capture(spec)` / `g.ui.setInput(text)` | own the composer area, or fill it |
| `g.setExtension(name, on)` | record a first-party extension's fate in config |

`g.ui.capture` is the whole of glrs's input primitive and deliberately the only
one: it draws `Line[]` where the composer sits and takes every key until you call
`close()`. the bundled question widget is written against nothing else, so a
picker, a form or a diff viewer is the same amount of work and none of them is
privileged over yours.

## tool filters compose

```ts
const held = g.filterTools((name) => name !== "bash");
held.lift();
```

every filter has to agree for a tool to survive, so restrictions can only narrow
and the handle lifts yours and nobody else's: a read-only extension and a
no-network extension can both be installed without either undoing the other, and
`tools.disable` from config rides the same seam. filtering removes the tool from
the schema the model is sent; a `tool_call` handler returning `false` refuses a
call the model has already made. [tools](./4-tools.md) has why withholding is
the stronger of the two.

## three hosts

`g.mode` is `"tui"` in an interactive session, `"print"` for a `-p` run, and
`"cli"` for a subcommand, the route decides it, one host each.

the print host has no composer and no session file, so `ui.capture`, `models()`
and `setModel()` throw; `send()`, `setInput()`, `reload()` and `setExtension()`
say on stderr that they mean nothing here and are ignored; `session()` answers
with a stub and `appendEntry` has nothing to write to. `g.print` writes to
stderr, assistant text is the only thing on stdout, so `glrs -p … | pbcopy`
copies the answer and not your extension's chatter.

the cli host is thinner still. `glrs wt list` opens no session, calls no model
and never touches the alternate screen; session-bound members throw by name
rather than return something plausible:

```
g.model() needs a session, and a glrs subcommand runs outside one. Use a slash
command or a tool for anything that talks to the model.
```

what a subcommand gets is git, the filesystem, and `g.print` straight to stdout,
undecorated and unwrapped, so `glrs wt list` pipes into the next command.
`g.root`, `g.exec`, `g.settings`, `g.columns` and `g.available` answer as usual;
`g.setExtension` returns `not-allowed`, since changing the roster is something
somebody agreed to in conversation and there is no conversation. `glrs --help`
lists what was registered, under `Added by extensions:`, see
[command line](./5-cli.md) for how a bare word reaches you at all.

flags registered with `g.flag` reach the TUI only: everything after `-p` is the
prompt, and the print route parses what precedes it and then throws the flags
away, so `glrs --greet hi -p "…"` never calls your `run`. what each spelling
delivers, and what happens to a flag nobody claimed, is in
[command line](./5-cli.md).

## lines and spans

everything drawn (transcript output, tool rows, the footer, a capture) is
`Line[]`, glrs's own span structure rather than the renderer's types, so the
renderer can be replaced without touching an extension.

```ts
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

`fill` paints a span's background and pads the line out to the terminal width, so
a highlighted row reads as a band rather than as coloured text with a ragged
right edge. one filled span in a line is enough to stretch it.

## running it

```sh
glrs branch                   # the subcommand, no session, no model
glrs -p "use stash_list"      # the tool, one headless turn
```

print mode loads extensions exactly as the TUI does, a tool the agent writes for
itself has to exist when it verifies with `-p`, or self-extension is a claim
nothing can check.

`/reload` re-reads skills, commands and extensions from disk, re-imports each
extension file with a cache-busting token so an edit is actually picked up, and
re-reads the `extensions` and `tools` blocks of config. it does not re-read the
model, does not touch the conversation, and does not fire `session_start` again,
state an extension computes there stays as it was until you restart. tool filters
are reset, then the configured bans re-applied.

an extension runs with the permissions of the process that launched glrs and
there is no approval gate: see [tools](./4-tools.md) for why. `/extensions` is
the account you get of what loaded and what it did.

the turn loop your hooks fire inside, every lifecycle event in the order it
fires, and what the session file on disk holds are in
[how glrs works](./9-internals.md). for exact signatures, every type and every
payload, the generated **Extension API** reference is built from
`packages/glrs-coding-agent/src/public-extension-api.ts` at docs-site build
time.
