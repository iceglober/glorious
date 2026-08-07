# glorious

[![npm](https://img.shields.io/npm/v/@glrs-dev/glorious/next?label=npm%40next)](https://www.npmjs.com/package/@glrs-dev/glorious)
[![docs](https://img.shields.io/badge/docs-glrs.dev-67d4e8)](https://glrs.dev)

A terminal-based coding agent.

```sh
bun add --global @glrs-dev/glorious@next
export AZURE_OPENAI_API_KEY=…   # or AZURE_FOUNDRY_API_KEY / AZURE_API_KEY
export AZURE_RESOURCE_NAME=…
glorious
```

Documentation: [glrs.dev](https://glrs.dev)

## Decisions

### Edit tool: multi

One call carries edits for any number of files. Every edit in every file is
resolved before anything is written, and each file is swapped into place by
rename rather than rewritten in place.

Measured against per-file batching, four bugs either concentrated or spread
across four modules, n=4 per cell:

- **Same work, one file** — identical: 1 call, 4 steps, ~2.8k input tokens both ways.
- **Same work, four files** — multi used **1 call vs 4**, **4 steps vs 7**, and
  **3.1k input tokens vs 6.3k** — half the input.
- Structural, not noise: every seed produced 4 calls / 7 steps for per-file
  batching and 1 / 4 for multi.
- Accuracy did not separate them — 16/16 runs passed either way. The gain is
  cost, not correctness.
- An earlier study picked per-file batching over one-edit-per-call and
  hash-anchored editing on the same grounds; this extends it across files.

Harness and fixtures: [`eval/edit`](eval/edit).

### Web fetch: headless Chrome + trafilatura

`web_fetch` renders with an already-installed Chrome via `--dump-dom`, then
extracts with trafilatura through `uvx`.

- Renders JavaScript, so single-page apps return content rather than an empty shell.
- **No new dependencies.** The obvious port pulled puppeteer, which downloads its
  own ~300MB Chromium; glorious ships five runtime dependencies in total.
- Degrades instead of failing: no browser falls back to a plain fetch, no `uv`
  falls back to a tag strip.
- Cross-host redirects are reported, not followed, so a login wall cannot quietly
  become the answer.

### Semantic code tools: Serena, curated

Symbol-level navigation and refactoring over MCP, addressed by symbol rather
than line offset — so what they return stays valid after an edit moves the file.

- **11 tools admitted, not ~30.** Serena's file and shell tools duplicate
  built-ins that already enforce path confinement, output caps, and
  process-group kill; only the symbol tools have no equivalent here.
- A built-in always wins a name collision.
- Adoption needed prompting. Left to itself the model reached for `grep`; the
  guidance had to name grep's failure — it also matches comments, strings, and
  unrelated identifiers — before the semantic tools were used.

### Caching: nothing volatile in the system prompt

The system prompt is byte-identical across turns, sessions, and projects.
Everything volatile — working directory, git state, skills catalog — rides in
the per-turn message instead, frozen into history when written.

- A resumed session reuses its history: **98% cached**, against 0% when the
  environment block lived in the system prompt.
- Reloading skills mid-session keeps the cache: **91%**, against 0% before.
- Tool definitions are built per turn but serialise identically, so the payload
  stays stable.
- A test fails if anything volatile reappears in the system prompt.

## Development

```sh
bun run test        # tests
bun run typecheck   # tsc
bun run check       # biome
bun run glorious    # run from source
```

MIT
