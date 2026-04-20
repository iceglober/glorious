---
name: plan-loop
description: Poll for unplanned work requests (tasks in understand phase), research and plan them into epics. Use when you want autonomous planning of queued work requests. Run in a dedicated Claude session alongside /auto-loop sessions.
argument-hint: "[epic-filter]"
disable-model-invocation: false
---

# Plan Loop — Autonomous Planning Agent

Poll for standalone tasks in `understand` phase (work requests submitted via the web dashboard), claim them, run research + deep-plan to create actionable epics, and loop back.

## Input

Optional: `$ARGUMENTS` — not typically used. The skill auto-discovers unplanned tasks.

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

## Step 1: Find unplanned work requests

```bash
gs-agentic state task list --phase understand --json
```

Filter the results for tasks that are:
- **Standalone** (no `epic` field)
- **Unclaimed** (no `claimedBy` field)

If no matching tasks found: report "No pending work requests — waiting for submissions." and stop. The `/loop` will retry on the next iteration.

## Step 2: Claim the work request

Pick the first unclaimed standalone `understand` task and transition it to `design`:

```bash
gs-agentic state task transition --id <task-id> --phase design --actor plan-loop
```

This atomically moves the task out of `understand`, so other plan-loop agents won't pick it up.
If the transition fails (already transitioned by another agent), go back to Step 1 and try the next one.

Read the task's title and description — these are the user's work request prompt.

## Step 3: Research and plan

Use the task's title + description as the research/planning prompt.

Invoke `/loop` with the following arguments:

```
2m Research and plan the work request below, then stop.

TASK: <task-id> — "<task-title>"
DESCRIPTION: <task-description>

RULES:
1. Run `/research <task title and description>` to gather context about what's needed.
2. Run `/deep-plan <task title and description>` to create a zero-ambiguity implementation plan.
   - deep-plan will create an epic with tasks automatically.
3. After deep-plan completes, note the epic ID it created.
4. Transition the original work request to done:
   `gs-agentic state task transition --id <task-id> --phase done --actor plan-loop`
5. Add a note linking to the new epic:
   `gs-agentic state task note --id <task-id> --body "Planned as epic <epic-id>"`
6. Report: "Work request <task-id> planned as <epic-id> with N tasks."
7. Check for more work requests:
   `gs-agentic state task list --phase understand --json`
   If there are more unclaimed standalone tasks, claim the next one and repeat from step 1.
   If none remain, report "All work requests planned." and stop.
```
