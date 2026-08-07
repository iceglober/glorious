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

The goal was to start from first-principles and make deliberate decisions about
the glorious implementation. Here are some of them.

- **Edit tool: multi.** One call edits any number of files. Everything resolves
  before anything is written; files are swapped in by rename.
  - Across four files: 1 call vs 4, 4 steps vs 7, 3.1k vs 6.3k input tokens.
  - Within one file, identical to per-file batching.
  - Accuracy unchanged — 16/16 either way. The win is cost. ([`eval/edit`](eval/edit))
- **Web fetch: installed Chrome, then trafilatura.** Renders JavaScript, so SPAs
  return content.
  - No new dependencies. puppeteer would have added its own ~300MB Chromium.
  - No browser falls back to plain fetch; no `uv` falls back to a tag strip.
  - Cross-host redirects are reported, not followed.
- **Serena for semantic code tools, curated to 11.** Symbols, not line offsets,
  so results survive an edit.
  - Its file and shell tools duplicate built-ins; only symbol tools admitted.
  - Built-ins win name collisions.
  - The model kept reaching for `grep` until the prompt named grep's failure mode.
- **Caching: nothing volatile in the system prompt.** Working directory, git
  state and skills ride in the per-turn message instead.
  - Resumed session: 98% cached, against 0% before.
  - Skills reload mid-session: 91%, against 0%.
  - A test fails if anything volatile reappears.

## Development

```sh
bun run test        # tests
bun run typecheck   # tsc
bun run check       # biome
bun run glorious    # run from source
```

MIT
