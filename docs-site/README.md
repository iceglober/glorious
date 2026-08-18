# Docs site

## Local visual editing

From the repository root:

```sh
pnpm --filter docs-site edit
```

This installs the docs-site dependencies, starts the local site, and opens edit
mode in the browser at `http://127.0.0.1:4174/?edit=1`.

Content stays inert until it is double-clicked. Editable blocks highlight on
hover; leaving an active block saves its source file directly into the working
tree. Contextual controls add sections, pages, and Markdown paragraphs. New
pages create `docs/published/<slug>.md` and update the navigation manifest.
The result can be reviewed with `git diff` and committed normally.

Markdown pages may include `{{generated:extension-api}}` and `{{asset:path}}`
directives. Generated content is expanded outside edit mode.

The generated Extension API reference is read-only because its source of truth
is `packages/glorious-coding-agent/src/extension-api.ts`.
