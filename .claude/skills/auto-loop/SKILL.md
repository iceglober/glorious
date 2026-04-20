---
name: auto-loop
description: Autonomously claim, implement, review, and QA tasks from an epic. Transitions completed tasks to verify phase (human gate). Use when you want a Claude session to work through tasks without manual intervention. Pair with /plan-loop for end-to-end autonomous workflows.
argument-hint: "[epic-id]"
disable-model-invocation: false
---

# Auto Loop — Autonomous Implementation Agent

Claim ready tasks from an epic, implement them, run deep-review and QA, generate a summary, transition to `verify` (human gate), and claim the next task.

## Input

Optional: `$ARGUMENTS` — an epic ID (e.g. `e1`). If empty, auto-detects from current task or single active epic.

## Context: Current task

Run `gs-agentic state task current --format agent --with-spec` to get your current task with plan.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read `CLAUDE.md` for project-specific commands (typecheck, build, lint, etc.).

## Autonomous Mode

You are running as an autonomous agent. Follow these rules strictly:

1. **Do not ask the user questions.** You must never prompt for input. Make reasonable decisions based on the plan and codebase context.
2. **Store all findings in task notes.** Use `gs-agentic state task note --id <id> --body "..."` for important findings and summaries. Use `--ephemeral` for transient progress updates.
3. **Failure budget: max 2 retry attempts per task.** If typecheck/tests fail after implementing, fix and retry (up to 2 attempts). On the 3rd failure, add a note describing the issue and transition the task to `cancelled`.
4. **Use token-efficient output.** Use `--format agent` on commands that support it (`task show`, `task current`, `task list`). Use `--json` on others (`task next`, `epic list`). Use `gs-agentic status --compact --epic <id>` for progress checks.

**State mutations (`--id` defaults to last-touched task if omitted):**
- `gs-agentic state task transition --id <id> --phase <phase>` — advance phase
- `gs-agentic state task transition --id <id> --phase done --close-and-claim-next` — close and atomically claim next task in epic
- `gs-agentic state task transition --ids <comma-list> --phase <phase>` — batch transition
- `gs-agentic state task note --id <id> --body "..."` — log finding
- `gs-agentic state task note --id <id> --body "..." --ephemeral` — log ephemeral progress (prunable)
- `gs-agentic state task notes --id <id> --prune-ephemeral` — clean up progress notes
- `gs-agentic state task next --epic <id> --claim <actor>` — atomically find and claim next ready task
- `gs-agentic status --compact --epic <id>` — single-line progress summary

**Claim enforcement:** Claims are enforced at the database level. If a task is claimed by a different actor, `gs-agentic state task transition` will reject with an error. Terminal transitions (done/cancelled) always succeed regardless of claim. Use `--force` to override non-terminal claims if needed.

**Output convention:** All `create` and `add-task` commands print the machine-readable ID on the **last line** of stdout. Capture it with `... | tail -1` — never parse with grep.

## Step 1: Find work to do

### Option A: Specific epic ID provided

If `$ARGUMENTS` contains an epic ID (e.g. `e1`, `e2`):
- Use that as the epic ID and go to Step 2.

### Option B: Auto-detect

1. Run `gs-agentic state task current --json` to find the current task.
2. If a task is found with an `epic` field → use that epic ID.
3. If no task found:
   - Run `gs-agentic state epic list --json` — if exactly one active epic exists, use it.
   - If no epic found → report "No active epics. Submit work via the dashboard or run /deep-plan first." and stop.

## Step 2: Claim and execute

### Read current state

```bash
gs-agentic status --compact --epic <epic-id>
gs-agentic state plan show --id <epic-id>
```

Read `CLAUDE.md` for project-specific commands (typecheck, build, lint, etc.).

### Find and claim the next task

```bash
gs-agentic state task next --epic <epic-id> --claim auto-loop --json --with-spec
```

- If exit code 1 (no ready tasks): check if all tasks are done or in verify. Report "All tasks complete or awaiting review." and stop.
- If a task is returned: it is claimed and in `implement` phase. Execute it.

### Execute the task

Invoke `/loop` with the following arguments:

```
1m Execute the next gs-agentic task following the autonomous rules below, then stop.

TASK: <task-id> — "<task-title>"
EPIC: <epic-id>

RULES:
1. Run `gs-agentic state task show --id <task-id> --json --with-spec` to get full details.
2. If the task has a plan, read it: `gs-agentic state plan show --id <task-id>`
3. Read the epic plan for overall context: `gs-agentic state plan show --id <epic-id>`
4. Find the matching step in the plan — read ALL files listed in that step.
5. Read CLAUDE.md for build/test commands.

IMPLEMENT:
6. If the step has test cases: write tests FIRST, run them, confirm they fail.
7. Write the implementation.
8. Run verification: typecheck + tests + build. No exceptions.
9. If verification fails: fix and retry (max 2 attempts total).
10. If still failing after 2 retries:
    - Add note: `gs-agentic state task note --id <task-id> --body "FAILED: <error summary>"`
    - Cancel task: `gs-agentic state task transition --id <task-id> --phase cancelled --actor auto-loop`
    - Claim next: `gs-agentic state task next --epic <epic-id> --claim auto-loop --json --with-spec`
    - If next task exists, repeat from step 1. Otherwise stop.

REVIEW:
11. Run a thorough code review of the changes:
    - Check for security issues, data integrity, duplicate code, type safety
    - Verify the implementation matches the plan's requirements
    - If CRITICAL issues found: fix them before proceeding

QA:
12. Run QA verification:
    - Spec compliance: does the code address each requirement from the task?
    - Code quality: no duplicates, proper error handling, type safety, no debug artifacts
    - Run typecheck + tests + build one final time as fresh verification
13. If QA fails with CRITICAL findings: fix and re-verify (counts toward the 2-retry budget)

COMPLETE:
14. Generate a summary note:
    `gs-agentic state task note --id <task-id> --body "Completed: <what changed>, <verification result>, <review findings if any>"`
15. Transition to verify (human gate):
    `gs-agentic state task transition --id <task-id> --phase verify --actor auto-loop`
16. Commit all changes: `<task title>`
17. Claim next task:
    `gs-agentic state task next --epic <epic-id> --claim auto-loop --json --with-spec`
18. If next task exists, repeat from step 1 with the new task.
19. If no tasks remain: report progress and stop.
    `gs-agentic status --compact --epic <epic-id>`
```
