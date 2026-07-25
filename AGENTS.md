# AGENTS.md — glorious

## What this repo is
- Product: `core/` — a Bun TypeScript terminal coding agent: a basic chat TUI over an agent with bash/read/edit/search tools, Azure-only LLM. The sole shipped implementation.
- Root layer: `package.json` convenience scripts for test/typecheck/docs; not a separate app.

## Component map
- `core/agent-loop.ts` — the sole production composition root: resolves the project root, builds the agent, the chat session, and the OpenTUI screen; owns SIGINT lifecycle. Wires but never orchestrates.
- `core/lib/chat/` — the interaction core, pure logic with no TTY. `session.ts`: one foreground turn at a time over an opaque message continuation, message queueing, abort. `events.ts`: the ChatEvent union the TUI renders.
- `core/lib/cli/` — `cmd-ts` dispatch: bare invocation → chat; `--help`/`--version`. `describeCli()` feeds the generated docs.
- `core/lib/tui/` — terminal surface. `opentui-chat-screen.ts`: full-screen OpenTUI renderer (transcript ScrollBox, progress block, composer Textarea, status line). `editor.ts`/`terminal-editor.ts`: grapheme-aware text helpers and pure layout. `transcript-item.ts`: the one seam lowering ChatEvents to renderable blocks. `progress.ts`/`status.ts`: live-region line composition.
- `core/lib/agent/` — agent assembly: `index.ts` composes llm + prompt + tools (bash/read/search/edit, always available, activity-wrapped for the progress UI).
- `core/lib/workspace/` — host execution (`host-adapter.ts` runs in the caller's checkout) and `project-source.ts` (launch dir → canonical worktree root).
- `core/lib/tools/` — agent tools: `bash/`, `edit/` (exact|batch|hash modes), `read/`, `search/`, `spill.ts` (over-cap output store). Defined against the sandbox port; no vendor SDK imports.
- `core/lib/llm/` — port + adapters (`ai-sdk-adapter.ts`, `azure-adapter.ts`). `GenerateRequest.messages`/`RunResult.messages` carry the chat continuation as an opaque token only the adapter understands. Azure is the only provider; credentials come from env (`AZURE_FOUNDRY_API_KEY`/`AZURE_API_KEY`, `AZURE_RESOURCE_NAME`). `continuation.ts` compacts long histories.
- `core/lib/prompt/` — pure prompt composition: per-model profiles, flag-gated blocks, promptVersion hashing.
- `core/lib/sandbox/` — the `Sandbox` execution-environment type the tools are defined against.

## How the pieces fit together
- `core/agent-loop.ts` is the only composition root; domain modules never construct production dependencies.
- The chat session emits `ChatEvent`s; the screen renders them and decides nothing. Pure logic (chat/, prompt/, editor model) is separated from IO (the screen, adapters).
- Ports and domain services depend on zod and other lib modules only; vendor imports live only in `*-adapter.ts` files (see `core/lib/README.md`).

## Conventions
- `createX(...)` closure factories, no classes/managers/services.
- Each domain owns its zod schema.
- Every module has a colocated `.test.ts`; `bun test core docs`, `tsc --noEmit`, and `bun run check` must stay green at every commit.
