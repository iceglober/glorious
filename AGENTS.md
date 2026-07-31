# AGENTS.md — glorious

## What this repo is
- Product: `v2/` — a Bun TypeScript terminal coding agent: a barebones chat TUI over an agent with bash/read/write/edit/grep/glob tools, Azure-only LLM. The sole shipped implementation.
- Root layer: `package.json` convenience scripts for test/typecheck/docs; not a separate app.

## Component map
- `v2/index.ts` — the composition root: resolves the project root, probes the environment, builds the agent, the chat, and the OpenTUI screen; owns the animation ticker and SIGINT lifecycle. Wires but never orchestrates.
- `v2/chat.ts` — the interaction core, pure logic with no TTY. One foreground turn at a time over a message history, FIFO queue drain, LIFO dequeue, abort, and a one-shot `[note]` carried into the next prompt after an interrupt, error, or step limit. Emits the `ChatEvent` union the TUI renders.
- `v2/agent.ts` — model construction and one turn: Azure via `@ai-sdk/azure`, the tool loop via the AI SDK's `generateText`. Credentials come from env (`AZURE_FOUNDRY_API_KEY` / `AZURE_API_KEY` / `AZURE_OPENAI_API_KEY`, plus `AZURE_RESOURCE_NAME`). Carries a request deadline and a bounded retry for transient connection failures. Assistant text is surfaced from `onLanguageModelCallEnd`, which fires *before* tool execution — so a preamble prints above the tools it announces.
- `v2/tools.ts` — the six tools, defined against one `run()` helper over `Bun.spawn`. Every result is a string, errors return `ERROR: …`, nothing throws. Path confinement, per-stream output caps, process-group kill on abort or timeout.
- `v2/render.ts` — pure: `ChatEvent` and activity state in, semantic `Line`/`Span` data out. No ANSI, no OpenTUI import. Owns markdown-lite, the tool rows, the sweep and VU animations, and the status line.
- `v2/ui.ts` — the only file that imports `@opentui/core`. Full-screen renderer: transcript ScrollBox, progress block, composer Textarea, status line. Renders and routes keys; decides nothing.
- `v2/prompt.ts` — one function returning the system prompt, with the volatile environment footer last so the long prefix stays prompt-cacheable.
- `docs/` — the generated single-page site at glrs.dev, built from `docs/content/*.md`.

## How the pieces fit together
- `v2/index.ts` is the only composition root; the other modules never construct production dependencies.
- `chat.ts` emits `ChatEvent`s; the screen renders them and decides nothing. Pure logic (`chat.ts`, `render.ts`, `prompt.ts`) is separated from IO (`ui.ts`, `agent.ts`, `tools.ts`).
- `render.ts` is the shared leaf module: `ui.ts`, `index.ts`, `chat.ts`, and `tools.ts` all import from it, and nothing imports them back.

## Conventions
- `createX(...)` closure factories, no classes/managers/services.
- **`v2/` carries no comments.** Names and structure carry the meaning. Keep it that way.
- Simplicity is the product here: no abstraction with a single implementation, no port/adapter split, direct vendor imports.
- `bun test docs`, `tsc --noEmit`, and `bun run check` must stay green at every commit.
