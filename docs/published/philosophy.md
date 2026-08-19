# Philosophy

glrs is a simple coding agent for developers and technical problem solvers.
It combines a model, tools, context, and a turn loop that can inspect and change
the repository where it runs.

Its promise is a **minimal core with maximum extensibility**. The core provides a
small set of composable primitives. Tools, commands, skills, lifecycle hooks,
status, and rendering are capabilities that can be added without forking.

## Direct execution

There are no permission prompts. glrs runs with the permissions of the
process that launched it. Permission prompts are not a security boundary for an
agent that can already edit and execute; use git review, worktrees, containers,
or operating-system controls when a boundary matters.

## The runtime language

A **session** is the persisted conversation. A **turn** is one request and the
model/tool work it causes. Extensions are TypeScript modules discovered from a
project or personal configuration and loaded through the public API.

The interactive terminal UI and `glrs -p` are two front ends to the same
turn-oriented runtime. Its behavior is defined by the tools, context, and
turn loop exposed through the runtime.
