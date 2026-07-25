# core/lib — architecture

Package-by-domain, layer-by-file. Each folder is one domain; the layer of a
file is encoded by its name, not by a `ports/` / `adapters/` tree.

## The three kinds of module

1. **Ports** — boundaries to external systems. `index.ts` in the domain folder:
   the interface and its zod config schema. The main two are `sandbox/`
   (command execution + file IO) and `llm/` (the model *and* its generation
   loop — one boundary, the `AgentRuntime` interface). `tools/bash/` is a thin
   port too: it quarantines the `bash-tool` vendor package behind a vendor-free
   `ToolSet`.
2. **Adapters** — `*-adapter.ts` next to their port, one per external SDK:
   `llm/ai-sdk-adapter.ts` (the AI SDK — `ToolLoopAgent` + `tool()` behind
   `AgentRuntime`), `llm/azure-adapter.ts` (Azure model auth), and
   `tools/bash/bash-tool-adapter.ts` (the `bash-tool` package → `ToolSet`).
   Only adapters import vendor SDKs.
3. **Domain services** — everything else. Pure logic written against ports,
   no vendor imports: `tools/edit` + `tools/read` + `tools/search` (agent
   tools defined with the port's `defineTool`, no SDK), `prompt/` (pure
   prompt composition), `agent/` (assembly of llm-runtime + prompt + tools),
   `chat/` (the interaction core: session turns, queueing — pure, no TTY),
   `tui/` (the OpenTUI screen plus pure layout/rendering helpers).

## Rules

- Ports and domain services depend on zod and other lib modules only — never
  on vendor SDKs. Vendor imports (`ai`, `@ai-sdk/azure`, `bash-tool`,
  `@opentui/core`) live **only** in `*-adapter.ts` files and the TUI screen.
- Every domain exports its own config schema; `agent/index.ts` composes the
  agent-facing ones.
- The composition root (`core/agent-loop.ts`) is the only place that picks
  adapters and wires ports together.
