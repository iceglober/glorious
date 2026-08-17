# Monorepo transition plan

## Goal

Separate the reusable agent runtime from the terminal coding-agent product while
keeping one repository, one test strategy, and one release workflow.

```text
packages/
  glorious-core/          # SDK/runtime: provider loop, tools, sessions, extensions
  glorious-coding-agent/  # terminal product: TUI, CLI, coding defaults, bundled UX
  extensions/
    builtins/             # first-party commands and default capabilities
    web-fetch/            # browser-backed web_fetch extension
```

The package names are `glorious-core` and `glorious-coding-agent`. The current
`@glrs-dev/glorious` package becomes the coding-agent distribution during the
transition and eventually becomes a compatibility package or an alias, subject
to a separate release decision.

## Boundaries

### glorious-core

Core owns the SDK contract and runtime primitives:

- model/provider abstraction and turn execution
- tool registration and tool lifecycle events
- extension loading and the `Glorious` API
- sessions, transcript events, compaction, usage, and configuration primitives
- stable types for tools, commands, hooks, render lines, and host capabilities

Core does not know about OpenTUI, terminal keybindings, coding-specific prompts,
package-manager installation, or bundled product commands.

### glorious-coding-agent

The coding agent owns the product experience:

- TUI, composer, terminal rendering, and keyboard behavior
- CLI entry points, `-p`, `doctor`, `update`, and resume UX
- coding-agent system prompt and repository context
- default tools for files, shell, search, mentions, and skills
- the default package and executable named `glorious`

The coding agent depends on core. Core never imports the coding agent.

### First-party extensions

Built-in extensions are independently testable packages that depend on core:

- command listings such as help, skills, extensions, reload, clear, compact, and session
- `web-fetch`
- future provider-specific or workflow-specific capabilities

A built-in extension may be bundled by the coding agent, but it must remain
usable through the same extension API as a user extension.

## Migration phases

1. **Inventory and contracts** — classify every current module as core,
   coding-agent, or extension; freeze the public core API and identify imports
   that cross the intended boundary.
2. **Workspace skeleton** — add the package manager workspace, package manifests,
   shared TypeScript/Biome configuration, and package-level test commands.
3. **Extract core** — move `extension-api`, events, sessions, model plumbing,
   extension loading, and shared render types into `glorious-core`; preserve
   behavior through moved tests before changing APIs.
4. **Move the product** — move the TUI, CLI, coding tools, prompt, guidance,
   mentions, and skills integration into `glorious-coding-agent`.
5. **Extract built-ins** — move bundled commands and web fetch into extension
   packages; load them from the coding agent without privileged code paths.
6. **Release transition** — publish `glorious-core` first, then publish the
   coding agent with an explicit dependency range. Keep the existing executable
   and configuration paths working through at least one transition release.
7. **Enforce boundaries** — add dependency checks and package-level API tests so
   core cannot import product code and extensions cannot reach private modules.

## Decisions to make before phase 2

- workspace manager and package layout (`bun` workspaces versus another tool)
- whether core owns provider implementations or only provider interfaces
- session file compatibility and schema ownership
- whether `Line[]` is a core UI contract or a coding-agent renderer contract
- versioning policy for core, coding agent, and first-party extensions
- compatibility package strategy for `@glrs-dev/glorious`
