---
title: architecture
---

# architecture

glrs is a Bun/TypeScript monorepo with four runtime layers.

| package | owns |
| --- | --- |
| `glrs-core` | provider-neutral events, sessions, settings, and shell primitives |
| `provider-registry` | providers, credentials, model resolution, and metadata |
| `glrs-coding-agent` | CLI, turn queue, TUI, discovery, and extension host |
| `extensions/*` | first-party tools and commands |

## startup

```text
CLI arguments
  → project root
  → config + model
  → session
  → skills + commands + extensions
  → TUI or print host
```

`doctor` stops before running extension code. it resolves and reports the plan
only.

## one turn

```text
input
  → queue
  → per-turn context
  → provider stream
  → tool calls, if any
  → final response
  → session events on disk
```

a turn may contain several model calls. each tool result returns to the model
before the next call.

## stable prompt

the system prompt stays byte-identical across projects and turns. changing data
— date, git state, skills, extension contributions — goes in the per-turn user
message.

this preserves provider prompt-cache prefixes. tests fail when volatile content
moves back into the system prompt.

## extensions

`extension-api.ts` is a facade over existing seams, not a second runtime:

- `g.tool` registers through the same wrapper as first-party tools
- `g.exec` uses the same shell primitive as direct `!` commands
- `g.on` subscribes to the turn and tool event stream
- render callbacks return glrs `Line[]`, never terminal-library types

Project extensions load before User and first-party extensions. first registration
wins for tools and commands.

## rendering

runtime events become `Line[]` spans in the coding agent. the terminal layer
turns those spans into OpenTUI nodes.

streaming updates are batched on a 100 ms paint tick. unchanged frames are
skipped. there is no animation loop.

## persistence

sessions are JSON records with an event log. resume rebuilds conversation context,
usage totals, and extension entries from those events.

config is separate and merged from Project-User, Project, and User.

## entry points

`glrs` and `glrs -p` use the same model, tools, extensions, sessions, and turn
loop. only presentation differs:

| mode | assistant output | tool trail | interactive capture |
| --- | --- | --- | --- |
| TUI | transcript | transcript | yes |
| print | stdout | stderr | no |
