# Docs site

## Local content editor

From the repository root:

```sh
pnpm --filter docs-site edit
```

The command opens `http://127.0.0.1:4174/?edit=1`. Markdown pages use a
side-by-side source editor and live preview. Save with the page button or
Cmd/Ctrl+S; changes are written directly to `docs/published/` for review with
`git diff` and a normal commit.

The sidebar provides compact controls for adding sections and pages. New pages
create `docs/published/<slug>.md` and update `docs-site/src/content/site.json`.
Site chrome, navigation labels, section descriptions, and Install-page copy are
managed through the Site Settings panel.

Markdown pages may include `{{generated:extension-api}}` and `{{asset:path}}`
directives. Generated content is expanded outside edit mode. The generated
Extension API reference itself is read-only because its source of truth is
`packages/glorious-coding-agent/src/extension-api.ts`.
