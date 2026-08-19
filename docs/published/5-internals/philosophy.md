---
title: philosophy
---

# philosophy

glrs is a simple agent: a model, tools, context, and a turn loop over a git
repository.

## small core

tools, commands, skills, hooks, status, and rendering compose through public
seams. behavior that can be an extension does not need to be core.

## direct execution

glrs runs with the permissions of its process. confirmation prompts are not a
security boundary after an agent can edit and execute code. use git review,
worktrees, containers, or operating-system controls when a boundary matters.

## stable context

volatile project state stays out of the system prompt. it rides in per-turn
context so providers can reuse the stable prompt prefix.

## visible work

tool calls, failures, timing, usage, and compaction are shown in the transcript.
headless mode sends answers to stdout and the same tool trail to stderr.

## vocabulary

a **session** is a persisted conversation. a **turn** is one user request and
all model/tool work it causes. an **extension** is TypeScript loaded from
Project or User.
