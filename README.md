# glorious

[![npm](https://img.shields.io/npm/v/@glrs-dev/glorious/next?label=npm%40next)](https://www.npmjs.com/package/@glrs-dev/glorious)
[![docs](https://img.shields.io/badge/docs-glrs.dev-67d4e8)](https://glrs.dev)

A terminal-based coding agent.

```sh
curl -fsSL https://glrs.dev/install.sh | bash
export AZURE_OPENAI_API_KEY=…   # or AZURE_FOUNDRY_API_KEY / AZURE_API_KEY
export AZURE_RESOURCE_NAME=…
# Optional: account for provider-specific pricing differences.
export GLORIOUS_PRICE_MULTIPLIERS=azure=1.1
glorious
```

The script checks for [Bun](https://bun.sh) and git, offering to install Bun if
it is missing. To skip it: `bun add --global @glrs-dev/glorious@next`.

Documentation: [glrs.dev](https://glrs.dev)

A small core, extended by you. Eight built-in tools, a ~40-line system prompt,
no permission prompts, and a TypeScript extension API for everything else.

```sh
glorious                      # the chat TUI
glorious -p "<prompt>"        # one turn, headless: answer on stdout, tools on stderr
glorious --resume [id]        # pick a session back up
```

## Extending it

Ask it. "Add a tool that lists my open PRs" is a request glorious answers by
writing `.glorious/extensions/prs.ts` — its [docs](docs/extensions.md) ship with
it and its system prompt says where they are.

By hand, an extension is one file with no imports:

```ts
// .glorious/extensions/prs.ts
export default function (g) {
  g.tool({
    name: "open_prs",
    description: "List open pull requests for this repository.",
    input: g.z.object({}),
    execute: async () => (await g.exec("gh pr list")).stdout,
  });
}
```

Tools, slash commands, lifecycle hooks, status widgets and custom row rendering,
all through the same object. For reusable behavior, write an extension. Start at
[docs/system-design.md](docs/system-design.md), then
[docs/extensions.md](docs/extensions.md).

## System design

glorious is a simple coding agent with a minimal core and maximum extensibility.
Read the [system design](docs/system-design.md) and [glossary](docs/glossary.md)
for its philosophy and language.

## Decisions

Deliberate, and where there is a number it was measured.

- **`edit` batches across files: 51% fewer input tokens.**
  ([`eval/edit`](eval/edit)) Against per-file batching on work spanning four
  files; also 1 call vs 4, 4 steps vs 7. No accuracy difference — 16/16 either
  way. The win is cost.
- **Volatile content stays out of the system prompt, for the cache.**
  ([`eval/caching`](eval/caching)) Environment, git state, skills and extension
  contributions ride in the per-turn message and freeze into history. In the
  system prompt a resumed turn reuses 0% of its input; in the user message,
  nearly all of it. A test fails if anything volatile reappears above.
- **No subagents.** ([`eval/delegation`](eval/delegation)) Our own eval says
  delegating cost ~1.8× the tokens and ~2.6× the wall clock for the same answers.
  Its one real benefit — keeping the child's reading out of the parent's context
  — survives as `glorious -p` invoked through `bash`, where every step of the
  child is visible instead of hidden behind a keystroke.
- **No MCP.** 7–9% of the context window for tool schemas you mostly do not
  call, paid on every turn. An extension registers the same tools with no
  subprocess, no JSON-RPC, and no cost until it is installed.
- **No plan mode, no permission prompts, no model picker, no animation.** A
  confirmation dialog is not a boundary once an agent can write and run code;
  containers, worktrees and `git diff` are. The status line still says what the
  model is doing and for how long — that is information, not decoration.
- **`web_fetch` is a bundled extension, not a built-in.** It is the proof the
  API is real: if the largest tool glorious has could not be written against it,
  the API would be a toy. Drives an already-installed Chrome rather than
  puppeteer's ~300MB Chromium; falls back to plain fetch, then to a tag strip.

## Development

```sh
bun run test        # tests
bun run typecheck   # tsc
bun run check       # biome
bun run glorious    # run from source
```

MIT
