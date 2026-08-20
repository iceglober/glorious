# Published documentation audit

Superseded. The page-by-page table that was here reviewed a fifteen-page tree
that no longer exists — `4-reference/`, `5-customize/` and `5-internals/` are
gone, and the flat pages beside them were renumbered — so every row named a file
that had been deleted.

An audit that describes a structure nobody can find is worse than none: it reads
as current, and the pages it vouches for are not the pages being served.

The published docs are now nine flat pages, `1-getting-started.md` through
`9-internals.md`. Their accuracy is held by the source itself rather than by a
document beside them:

- `packages/glrs-coding-agent/src/prompt.test.ts` asserts that every path the
  system prompt names resolves under `docsPath()`, so a renumbering fails a test
  rather than failing a reader.
- `packages/glrs-coding-agent/src/extension-api.test.ts` reads the lifecycle
  section by path and counts its event rows against the `EventName` union.

Both exist because this directory is read twice over — once by the docs site,
and once by glrs, which `prompt.ts` deliberately points at documentation rather
than at implementation source. A wrong sentence here becomes a wrong extension
later, which is why the checks live in the test suite and not in prose.
