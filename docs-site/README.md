# Docs site

## Local visual editing

From the repository root:

```sh
pnpm --filter docs-site edit
```

This installs the docs-site dependencies, starts the local site, and opens edit
mode in the browser at `http://127.0.0.1:4174/?edit=1`. Published documentation and site chrome are editable in
place. Leaving an edited region saves its source file directly into the working
tree so the result can be reviewed with `git diff` and committed normally.

The generated Extension API reference is read-only because its source of truth
is `packages/glorious-coding-agent/src/extension-api.ts`.
