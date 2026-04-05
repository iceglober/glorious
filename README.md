<div align="center">

<br/>

# `glorious`

**AI-native development tools.**

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](LICENSE)

<br/>

</div>

## Packages

This monorepo contains two independent tools:

| Package | What it does | Language | Install |
|:--|:--|:--|:--|
| [`glorious-agentic`](packages/agentic/) | AI workflows for product & engineering, powered by Claude Code | TypeScript/Bun | `curl -fsSL https://raw.githubusercontent.com/iceglober/glorious/main/packages/agentic/install.sh \| bash` |
| [`glorious-assume`](packages/assume/) | Multi-cloud SSO credential manager with per-shell context switching | Rust | `curl -fsSL https://raw.githubusercontent.com/iceglober/glorious/main/packages/assume/install.sh \| bash` |

## Development

```bash
bun install              # install workspace dependencies
bun run build            # build all packages
bun run typecheck        # typecheck agentic
bun test                 # test agentic
```

For `glorious-assume` (Rust):

```bash
cd packages/assume
cargo build              # debug build
cargo test               # run tests
cargo clippy             # lint
```

See each package's README for detailed usage.

---

<div align="center">
<sub>MIT License</sub>
</div>
