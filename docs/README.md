# glorious docs

A small, dependency-free docs site. Build it with:

```
bun run docs        # or: bun docs/generate.ts
```

That rewrites `index.html` — the site. Open it directly, or serve `docs/` on
any static host.

## What is generated vs authored

- **`content/*.md`** — hand-written prose, the only source. Add a page by
  creating the file and listing it in `CONTENT_ORDER` in `generate.ts`; a file
  that exists but is not listed fails the build.
- **`index.html`** — output. Do not edit it by hand.

Advanced material is wrapped in `:::details <summary>` … `:::` so it renders as
a collapsed disclosure and stays out of the nav; lead with the common case.

## Drift guard

`generate.test.ts` re-renders in memory and pins the result against the
committed `index.html`. Editing prose without running `bun run docs` turns
`bun test docs` and CI red. Regenerate and commit.

The guard only proves the HTML matches the prose. Nothing checks the prose
against the code, so tool names, slash commands and keys have to be re-read
from `v2/` when they change — `v2/commands.ts` for slash commands,
`createTools` in `v2/tools.ts` for the tool list, and `v2/ui/screen.ts` for
keys.
