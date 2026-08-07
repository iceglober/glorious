# glorious

[![npm](https://img.shields.io/npm/v/@glrs-dev/glorious/next?label=npm%40next)](https://www.npmjs.com/package/@glrs-dev/glorious)
[![docs](https://img.shields.io/badge/docs-glrs.dev-67d4e8)](https://glrs.dev)

A terminal-based coding agent.

```sh
curl -fsSL https://glrs.dev/install.sh | bash
export AZURE_OPENAI_API_KEY=…   # or AZURE_FOUNDRY_API_KEY / AZURE_API_KEY
export AZURE_RESOURCE_NAME=…
glorious
```

The script checks for [Bun](https://bun.sh) and git, offering to install Bun if
it is missing. To skip it: `bun add --global @glrs-dev/glorious@next`.

Documentation: [glrs.dev](https://glrs.dev)

## Decisions

The goal was to start from first-principles and make deliberate decisions about
the glorious implementation. Here are some of them.

- **`edit` tool: extended batched edits across files to achieve 51% fewer input
  tokens.** ([`eval/edit`](eval/edit))
  - Against per-file batching, on work spanning four files. Also 1 call vs 4,
    4 steps vs 7.
  - No accuracy difference — 16/16 either way. The win is cost.
- **Caching: moved volatile content out of the system prompt to achieve 98%
  cache reuse on a resumed turn.** ([`eval/caching`](eval/caching))
  - Environment, git state and skills ride in the per-turn message, frozen into
    history when written.
  - A test fails if anything volatile reappears in the system prompt.
- **`web_fetch` tool: slimmed down
  [pi-web-fetch](https://github.com/georgebashi/pi-web-fetch) to achieve zero
  new dependencies.** Not benchmarked.
  - Drives an already-installed Chrome instead of puppeteer's own ~300MB
    Chromium. Still renders JavaScript.
  - Dropped its extension hooks and in-tool summarisation; `run_subagent`
    already covers the latter.
  - Falls back to plain fetch without a browser, to a tag strip without `uv`.
- **Semantic code tools: curated
  [Serena](https://github.com/oraios/serena) to achieve 11 tools instead of
  ~30.** Not benchmarked.
  - The rest duplicate built-ins that already enforce path confinement, output
    caps and process-group kill.
  - Adoption needed prompting: the model kept reaching for `grep` until the
    prompt named grep's failure mode.

## Development

```sh
bun run test        # tests
bun run typecheck   # tsc
bun run check       # biome
bun run glorious    # run from source
```

MIT
