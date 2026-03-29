import { TASK_PREAMBLE } from "./preamble.js";

export function qa(): string {
  return `---
description: QA the current diff against the task's acceptance criteria. Walks through each scenario, traces code paths. Provide optional focus area.
---

# QA

You are performing quality assurance on the current diff for this task.

## Input

Optional focus area: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Step 1: Understand the task

Read the current task's \`acceptance\` criteria — these are your primary test cases. Also read the \`items\` array to understand what was implemented.

## Step 2: Scope the diff

\`\`\`bash
git diff main...HEAD --stat
\`\`\`

Read every changed file. Classify each:
- **UI change** — renders something the user sees
- **API change** — affects data the UI consumes
- **Schema change** — affects what's stored
- **Config change** — affects system behavior

Ignore: refactors with no user-visible effect.

## Step 3: Build the test matrix

For each acceptance criterion, plus general scenarios:

| Scenario | Source | Risk |
|----------|--------|------|
| {acceptance criterion} | Task | High |
| Happy path | General | Low |
| Empty state — no data, first use | General | Medium |
| Error state — API fails, bad input | General | High |
| Boundary — very long text, many items, zero items | General | Medium |
| Concurrency — rapid clicks, duplicates | General | High |

Only include scenarios relevant to the changes.

## Step 4: Walk through each scenario

For each scenario:
1. **Describe the user action**
2. **Trace the code path** — component → API → database → response → render
3. **Check each layer:** loading states, input validation, error handling, recovery, state consistency
4. **Verdict:** PASS or FAIL with file:line reference

## Step 5: Check task items

Compare checked items in the backlog against the actual implementation:
- Items marked done but code doesn't fully implement them?
- Code that completes items not yet marked done?

Flag mismatches.

## Step 6: Report

\`\`\`
## QA Report

**Task:** {id}: {title}
**Diff:** {N} files changed
**Scenarios tested:** {count}
**Passed:** {count}
**Failed:** {count}

### Acceptance Criteria

| Criterion | Verdict | Notes |
|-----------|---------|-------|
| {criterion} | PASS/FAIL | {detail} |

### Failures

| # | Scenario | Gap | Severity | File |
|---|----------|-----|----------|------|
| 1 | {scenario} | {what's missing} | {severity} | {file:line} |

### Task Item Sync
- {mismatches between items and implementation}
\`\`\`

## Step 7: Fix (if asked)

If the user says "fix" or failures are critical:
- Fix each gap, typecheck after
- Mark any newly completed items in the backlog

## Rules

- Acceptance criteria are your primary test cases. Every one must be verified.
- Think like a user. "What if I click this twice fast?"
- Trace the full code path — don't assume layers handle errors.
- Don't test code that didn't change.
`;
}
