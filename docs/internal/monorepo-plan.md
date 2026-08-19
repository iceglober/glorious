# Monorepo transition plan

## Goal

Separate the reusable agent runtime from the terminal coding-agent product while
keeping one repository, one test strategy, and one release workflow.

```text
packages/
  glrs-core/          # SDK/runtime: turns, sessions, events, tools, extensions
  glrs-coding-agent/  # terminal product: TUI, CLI, coding defaults, bundled UX
  provider-registry/      # provider adapters, credentials, and model metadata
  extensions/
    builtins/             # first-party commands and default capabilities
    web-fetch/            # browser-backed web_fetch extension
```

The internal package names are `glrs-core` and `glrs-coding-agent`.
`@glrs-dev/glrs` remains the only published distribution and bundles the
internal package sources. Independent package publishing is deferred until the
SDK contracts stabilize.

## Boundaries

### glrs-core

Core owns the SDK contract and runtime primitives:

- provider-neutral model ports and turn execution
- tool registration and tool lifecycle events
- extension loading and the `Glrs` API
- session repository ports, transcript events, compaction, usage, and configuration primitives
- stable types for tools, commands, hooks, render lines, and host capabilities

Core does not know about OpenTUI, terminal keybindings, coding-specific prompts,
package-manager installation, or bundled product commands.

### glrs-coding-agent

The coding agent owns the product experience:

- TUI, composer, terminal rendering, and keyboard behavior
- CLI entry points, `-p`, `doctor`, `update`, and resume UX
- coding-agent system prompt and repository context
- default tools for files, shell, search, mentions, and skills
- the default package and executable named `glrs`

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
- The coding-agent source and tests live in `packages/glrs-coding-agent`.
- Provider configuration, adapters, metadata, and tests live in `packages/provider-registry`.
- Canonical events and JSON session persistence live in `packages/glrs-core`.
- Built-in commands, `ask_user`, and `web_fetch` are independent extension packages.
- The root package remains the public distribution for the `glrs` executable.
- Boundary checks are enforced; Changesets versions and publishes only the root package.

## Migration phases

1. **Domain artifact and contracts** — land `docs/internal/domain-model.md`,
   classify every current module as core, coding-agent, provider, or extension,
   coding-agent, or extension; freeze the public core API and identify imports
   that cross the intended boundary.
2. **Package skeleton** — add internal package manifests, shared
   TypeScript/Biome configuration, and package-level test commands while the
   root package remains the only install and release unit.
3. **Extract core** — move `extension-api`, events, sessions, model plumbing,
   extension loading, and shared render types into `glrs-core`; preserve
   behavior through moved tests before changing APIs.
4. **Move the product** — move the TUI, CLI, coding tools, prompt, guidance,
   mentions, and skills integration into `glrs-coding-agent`.
5. **Extract built-ins** — move bundled commands and web fetch into extension
   packages; load them from the coding agent without privileged code paths.
6. **Release transition** — publish the root `@glrs-dev/glrs` distribution
   with all internal package sources bundled. Keep the existing executable and
   configuration paths unchanged. Independent package releases are deferred.
7. **Enforce boundaries** — add dependency checks and package-level API tests so
   core cannot import product code and extensions cannot reach private modules.

## Decisions

- Bun manages dependencies at the repository root; internal package directories
  remain private source boundaries until independent publishing is enabled.
- Core owns provider-neutral model ports; provider implementations live in the registry.
- Core owns event schemas and the JSON session adapter, including fork support.
- Core exposes neutral UI and `Line[]` contracts; hosts may omit interactive capabilities.
- Internal workspace packages are private and are not versioned or published independently.
- `@glrs-dev/glrs` remains the sole public distribution during the transition.
