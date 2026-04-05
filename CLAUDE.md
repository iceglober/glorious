# glorious monorepo

Bun workspace monorepo containing:

- `packages/agentic/` — CLI tool (`gs-agentic`), TypeScript/Bun
- `packages/assume/` — credential assume manager (`gs-assume`), Rust

## Structure

- Root `package.json` is the workspace root (private, no dependencies)
- Each package has its own `package.json`, build scripts, and README
- `bun install` at root installs all workspace dependencies
- `bun run build` at root builds all packages

## Working on agentic CLI

```bash
cd packages/agentic
bun run build        # Build to dist/index.js
bun run dev          # Watch mode build
bun run typecheck    # bun x tsc --noEmit
bun test             # Run tests
```

See `packages/agentic/CLAUDE.md` for CLI-specific conventions.

## Working on assume

```bash
cd packages/assume
cargo build          # Debug build
cargo build --release # Release build
cargo test           # Run tests
cargo clippy         # Lint
```
