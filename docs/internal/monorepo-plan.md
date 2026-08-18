# Monorepo transition plan

## Goal

Separate the reusable agent runtime from the terminal coding-agent product while
keeping one repository, one test strategy, and one release workflow.

```text
packages/
  glorious-core/          # SDK/runtime: turns, sessions, events, tools, extensions
  glorious-coding-agent/  # terminal product: TUI, CLI, coding defaults, bundled UX
  provider-registry/      # provider adapters, credentials, and model metadata
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

- provider-neutral model ports and turn execution
- tool registration and tool lifecycle events
- extension loading and the `Glorious` API
- session repository ports, transcript events, compaction, usage, and configuration primitives
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

The coding agent depends on core and the provider registry. Core never imports
products, provider implementations, or extensions.

### provider-registry

The provider registry is a sibling package consumed by products. It owns provider
adapters, credentials, model metadata, and model instance construction. Core
consumes only the provider-neutral model port.

### First-party extensions

Built-in extensions are independently testable packages that depend on core:

- command listings such as help, skills, extensions, reload, clear, compact, and session
- `web-fetch`
- future provider-specific or workflow-specific capabilities

A built-in extension may be bundled by the coding agent, but it must remain
usable through the same extension API as a user extension.

## Implementation status

- Workspace and publishable package manifests are in place.
- The coding-agent source and tests live in `packages/glorious-coding-agent`.
- Provider configuration, adapters, metadata, and tests live in `packages/provider-registry`.
- Canonical events and JSON session persistence live in `packages/glorious-core`.
- Built-in commands, `ask_user`, and `web_fetch` are independent extension packages.
- The root package remains a compatibility distribution for the `glorious` executable.
- Boundary checks and synchronized Changesets versioning are enforced.

## Migration phases

1. **Domain artifact and contracts** — land `docs/internal/domain-model.md`,
   classify every current module as core, coding-agent, provider, or extension,
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

## Decisions

- Bun workspaces manage the monorepo.
- Core owns provider-neutral model ports; provider implementations live in the registry.
- Core owns event schemas and the JSON session adapter, including fork support.
- Core exposes neutral UI and `Line[]` contracts; hosts may omit interactive capabilities.
- Core, coding agent, provider registry, and first-party extensions use synchronized versions.
- `@glrs-dev/glorious` remains the compatibility distribution during the transition.
