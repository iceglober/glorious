# System design

## What glorious is

glorious is a simple coding agent: a model, a turn loop, context, and a small
set of composable tools that can inspect and change the repository in which it
runs. It is a terminal application, but its product boundary is the agent
runtime and the extension API behind it.

The intended users are developers and other technical problem solvers. The
promise is a minimal core with maximum extensibility, not a large catalog of
opinionated workflows.

## Design commitments

- **Small core.** The core owns the turn loop, sessions, discovery, a small
  stable set of primitive tools, and the extension API.
- **Extensions over features.** Tools, commands, skills, hooks, status, and
  custom rendering are capabilities an extension can add without forking.
- **Inspectable behavior.** The system prompt and the shipped documentation
  are deliberately small and available to the agent. The agent can create and
  verify extensions against the same API users have.
- **Direct execution.** glorious acts with the permissions of the process that
  launched it. Permission prompts are not a security boundary; users choose
  boundaries with git review, worktrees, containers, or operating-system
  controls.
- **Concrete language.** Describe what the agent does rather than calling it
  autonomous or collaborative.

## Runtime model

A **session** is the persisted conversation. A **turn** is one user request and
its model/tool work. A session contains many turns and can be resumed. The
interactive TUI and `glorious -p` are two front ends to the same turn-oriented
agent runtime.

Extensions are TypeScript modules discovered from the project or personal
configuration. They register capabilities through the `Glorious` API. Reload
is explicit and visible: discovered resources are re-read when the user
invokes reload, and active registrations are refreshed safely.

There is no sequence or `$name` workflow concept. A shell command is available
as `!` or through `g.exec`; a multi-step or reusable behavior belongs in an
extension or a user-invoked command.
