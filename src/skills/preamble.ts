/**
 * Shared preamble injected into skills that operate on a backlog task.
 * Tells the AI how to find and read the current task from .aflow/backlog.json.
 */
export const TASK_PREAMBLE = `## Context: Current task

Run \\\`git branch --show-current\\\` to get the current branch name.

Read \\\`.aflow/backlog.json\\\` and find the task whose \\\`branch\\\` field matches the current branch. This is your **current task**.

If no task matches, tell the user: "This branch isn't linked to an aflow task. Run \\\`af start\\\` to create one."

The task object has:
- \\\`id\\\` — task identifier (e.g. "t3")
- \\\`title\\\` — short description
- \\\`description\\\` — full context
- \\\`items\\\` — checklist of implementation tasks (\\\`{ text, done }\\\`)
- \\\`acceptance\\\` — acceptance criteria (strings)
- \\\`dependencies\\\` — array of task IDs that must complete before this task can start
- \\\`status\\\` — pending | active | shipped | merged
- \\\`branch\\\` — the git branch for this task
- \\\`pr\\\` — PR URL if shipped

Also read \\\`.aflow/spec.md\\\` for a formatted overview of the full backlog, and \\\`CLAUDE.md\\\` for project-specific commands (typecheck, build, lint, etc.).`;
