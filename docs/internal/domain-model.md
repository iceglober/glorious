# Glrs domain model

## Product boundary

glrs is a general agent runtime whose first product is a coding agent.
The runtime is `glrs-core`; the terminal product is
`glrs-coding-agent`. First-party capabilities are extensions, whether they
ship with the product or are installed by a user.

## Ubiquitous language

- **Agent** — the runtime that accepts turns, invokes a model, executes tools,
  and emits events.
- **Session** — the durable conversation aggregate. It owns identity, ordered
  event history, resumability, branches/forks, and the current projection
  boundary after compaction.
- **Turn** — one user input accepted by an agent and the resulting execution
  until it settles.
- **Step** — one provider response cycle: a model invocation, its optional tool
  calls and results, and any continuation needed to settle the turn.
- **Message** — a provider-facing conversational item. `ModelMessage[]` is a
  projection of the event log, not the persistence authority.
- **Event** — an append-only observable fact in a session: user input,
  assistant output, reasoning, tool start/end, usage, compaction, errors, and
  custom extension entries.
- **Tool** — a named capability with a description, input schema, optional
  execution adapter, lifecycle events, and optional rendering.
- **Tool call** — one invocation of a tool during a step, with one start and one
  end event.
- **Extension** — a deployable capability module that registers tools,
  commands, hooks, UI capabilities, and rendering through the core API.
- **Command** — a user-invoked named operation.
- **Skill** — reusable instructions discovered from `SKILL.md` resources.
- **Model** — a provider-backed inference capability selected for a step.
- **Provider** — an adapter or registry entry that resolves model access and
  credentials; provider implementations are not part of core.
- **UI capability** — an optional host port for output, structured questions,
  composer replacement, key capture, status, footer, activity, and rendering.

## Bounded contexts and packages

```text
                              ┌────────────────────────┐
                              │ glrs-coding-agent  │
                              │ CLI · TUI · coding UX  │
                              └───────────┬────────────┘
                                          │ depends on
                              ┌───────────▼────────────┐
                              │ glrs-core           │
                              │ sessions · turns       │
                              │ events · tools · API   │
                              │ optional UI ports      │
                              └──────┬──────────┬───────┘
                                     │          │
                         ┌───────────▼───┐  ┌───▼────────────────┐
                         │ provider-registry│  │ first-party       │
                         │ model adapters │  │ extension packages │
                         └────────────────┘  └────────────────────┘
```

### Core context

Core is mechanism-only. It owns turn execution, event contracts, session
ports, tool contracts, extension registration, model-facing message
projection, and optional host ports. It does not own terminal UI, coding
prompts, provider implementations, or product commands.

### Coding-agent context

The coding agent owns the CLI/TUI, coding defaults, repository context,
headless presentation, and the composition of core plus provider and extension
packages.

### Provider context

The provider registry resolves provider adapters, credentials, model metadata,
and model instances. Core consumes a provider-neutral model port. The registry
is a sibling package consumed by products.

### Extension context

An extension is a deployable capability module. Built-in and user extensions
have the same semantic status and use the same public API. Extensions do not
depend directly on one another; they communicate through core events or the
extension bus.

## Aggregates and projections

```text
Session
└── EventLog (append-only)
    ├── Turn
    │   └── Step
    │       └── ToolCall
    └── Projection boundary (compaction)

EventLog ──projects──> ModelMessage[]
EventLog ──projects──> transcript / usage / extension observations
```

A `SessionRepository` is the core port for creating, loading, appending,
resuming, branching, and forking sessions. JSON on disk is the default adapter,
not the domain model.

A turn settles exactly once. A tool call has exactly one start and one end.
Compaction records a projection boundary while preserving the complete event
history. A provider receives a `ModelMessage[]` projection; it never becomes the
source of session truth.

## Extension lifecycle

1. **Discover** resources from project and personal roots.
2. **Load** the module and validate its factory/export.
3. **Register** tools, commands, hooks, UI capabilities, and renderers.
4. **Activate** the registration for the session and current turn boundary.
5. **Reload** discovery and replace the registry at a safe boundary; newly
   found modules load, removed modules unregister, and session state remains.

A load failure is isolated to that extension and observable through diagnostics.
It cannot corrupt core state or prevent unrelated extensions from loading.

## UI and headless operation

Core exposes a UI capability interface, but does not require a UI. A host may
provide a TUI implementation, another application may provide a graphical or
web implementation, and headless mode may provide no UI at all. Operations
that require a person fail clearly when the host has no corresponding
capability.

## Public API and versioning

`glrs-core` exports the full domain model, stable ports, and extension API
from explicit package entrypoints. Deep implementation imports are not public.
The internal packages remain private implementation boundaries. The root
`@glrs-dev/glrs` distribution is the only package versioned and published
until the SDK contracts stabilize.

The extraction begins after this artifact and public API tests are established.
Package-boundary tests must enforce that core cannot import the coding agent or
extensions, and that extensions depend only on core.
