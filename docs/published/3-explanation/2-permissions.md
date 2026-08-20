---
title: permissions
---

# permissions

glrs runs with the permissions of its process: any file you can edit, any
command you can run. there is no sandbox and no approval prompt.

## paths

the file tools resolve relative paths against the project root and take
absolute ones as given. nothing is refused: `bash` sits unconfined beside them,
so a path check would only send the model the long way round.

## boundaries

a confirmation prompt is not a boundary once an agent can edit and execute
code. an extension can refuse a call from the `tool_call` hook, but it runs in
the same process. real boundaries come from outside: git review, worktrees,
containers, or operating-system controls.

see also: [tools](../9-reference/3-tools.md), [turn things off](../2-how-to/8-turn-things-off.md)
