---
name: fix
description: Fix bugs or implement changes for the current glorious task. Use when user says 'fix this bug', 'this is broken', 'something's wrong with', 'patch this', or reports specific errors. Classifies issues as bug/scope-change/new-work, reproduces with a failing test, fixes code, verifies fully.
argument-hint: "[bug description or error]"
disable-model-invocation: true
---

# Fix — Test-Driven Bug Resolution

Reproduce the bug with a failing test. Fix the code. Watch the test pass.

If you can't write a test that fails, you don't understand the bug yet.

## Critical Rules

- **Reproduce first, fix second.** Write a test that demonstrates the bug before touching production code.
- **Read source files before editing them.**
- The task's **acceptance criteria define what "correct" means**.
- If a fix **contradicts the task's intent**, flag it to the user instead of proceeding.

## Input

The user provides issues to address: `$ARGUMENTS`

## Context: Current task

Run `gs-agentic state task current --json --fields id,title,phase,branch,plan,epic,pr` to get your current task.
If exit code 1 (no task found), operate in ad-hoc mode without state tracking.

Also read `CLAUDE.md` for project-specific commands (typecheck, build, lint, etc.).

**State mutations (`--id` defaults to last-touched task if omitted):**
- `gs-agentic state task update --id <id> --field value` — update metadata
- `gs-agentic state task update --id <id> --depends-on <comma-list>` — fix dependencies
- `gs-agentic state task transition --id <id> --phase <phase>` — advance phase
- `gs-agentic state task transition --id <id> --phase done --close-and-claim-next` — close and atomically claim next task in epic
- `gs-agentic state task transition --ids <comma-list> --phase <phase>` — batch transition
- `gs-agentic state task note --id <id> --body "..."` — attach finding to task
- `gs-agentic state task note --id <id> --body "..." --ephemeral` — attach ephemeral note (prunable)
- `gs-agentic state task notes --id <id> --json` — list task notes
- `gs-agentic state task notes --id <id> --prune-ephemeral` — delete ephemeral notes
- `gs-agentic state plan set --id <id> --stdin` — save plan content (pipe via heredoc)
- `gs-agentic state plan sync --stdin` — atomic epic+tasks from stdin (pipe line-based format)
- `gs-agentic state qa --id <id> --status pass|fail --summary "..."` — record QA result
- `gs-agentic state task next --epic <id> --claim <actor>` — atomically find and claim next ready task in an epic

**Claim enforcement:** Claims are enforced at the database level. If a task is claimed by a different actor, `gs-agentic state task transition` will reject with an error. Terminal transitions (done/cancelled) always succeed regardless of claim. Use `--force` to override non-terminal claims if needed.

**Output convention:** All `create` and `add-task` commands print the machine-readable ID on the **last line** of stdout. Capture it with `... | tail -1` — never parse with grep.

**Recipes:**

*Atomic epic + tasks (preferred over individual add-task calls):*
```bash
cat <<'SYNC_EOF' | gs-agentic state plan sync --stdin --actor <role>
title: Epic title
description: One-line summary
---
ref:1.1 | Step 1.1: Verb phrase
ref:1.2 | Step 1.2: Verb phrase | depends:1.1
ref:2.1 | Step 2.1: Verb phrase | depends:1.1,1.2
SYNC_EOF
```
Returns JSON: `{ "epicId": "e1", "tasks": { "1.1": "t1", "1.2": "t2", ... } }`

*Claim → build → done cycle:*
```bash
gs-agentic state task next --epic <id> --claim <actor> --json  # claim next ready task
# ... do the work ...
gs-agentic state task transition --id <id> --phase done --actor <actor>
```

## Step 1: Understand and classify

Read each issue carefully. Classify each as:
- **Bug** — code doesn't match what the task describes (code changes, task stays)
- **Scope change** — the desired behavior differs from the task's items (both change)
- **New work** — something not covered by the task at all (add items, then implement)

## Step 2: Read the current diff

Determine what has changed to understand the context:

```bash
git diff --cached --stat
git diff --stat
git branch --show-current
git merge-base main HEAD
```

**Diff strategy (in order of precedence):**
1. If there are staged changes: `git diff --cached`
2. If there are unstaged changes: `git diff`
3. If the working tree is clean: `git diff $(git merge-base main HEAD)...HEAD`

Read the full diff and the relevant source files to understand the area you're working in.

## Step 3: RED — Write a failing reproduction test

For each issue:

1. Find or create the appropriate test file (`<module>.test.ts` next to the source)
2. Write a test that **reproduces the bug** — it should fail with the current code
3. Run the test suite:
   ```bash
   bun test
   ```
4. **Confirm: your new test FAILS.** If it passes, your test doesn't capture the bug — rewrite it.

**If the bug is genuinely untestable** (e.g. a typo in a log message, a cosmetic issue), note why and proceed to Step 4. This should be rare.

## Step 4: GREEN — Fix the code

1. Write the **minimal change** that fixes the bug and makes the failing test pass
2. Don't refactor unrelated code
3. Don't add features beyond the fix
4. Run the test suite:
   ```bash
   bun test
   ```
5. **Confirm: ALL tests pass** (new and existing)

## Step 5: Update the task (if needed)

Only update the task via `gs-agentic state task update` if an issue is a **scope change** or **new work**:
- Update the task description: `gs-agentic state task update --id <id> --description '<updated description>'`
- Leave unrelated tasks alone

## Step 6: Full verification

Run all checks — no exceptions:

```bash
bun run typecheck
bun test
bun run build
```

Then review your own changes:

```bash
git diff
```

Check for:
- Debug code left in (console.log, TODO)
- Unused imports
- Duplicate code blocks
- Unrelated changes

**Do not declare done until all checks pass.**

## Step 7: Report

```
## Fixed

**Task:** {id}: {title}
**Issues:** {count} addressed
**Classification:** {bug|scope-change|new-work for each}
**Tests:** {pass}/{total} (all green)
**Typecheck:** clean
**Build:** clean

### Changes
| # | Issue | Classification | Fix | Test |
|---|-------|---------------|-----|------|
| 1 | {description} | Bug | {what changed} | {test name or "N/A"} |
```
