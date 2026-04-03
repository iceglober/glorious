---
description: Ship the current task's branch — typecheck, review, commit, push, and create a PR. Use when user says 'ship it', 'create a PR', 'push and release', 'land this', 'send for review'. Runs full pre-flight pipeline before pushing. Never force-pushes or pushes to main.
---

# Ship

You are shipping the current task's branch. Pipeline: typecheck -> review -> commit -> push -> PR.

## Critical Rules

- **Never skip typecheck or review.**
- **Never force-push.**
- **Never push to main directly.**
- **Never commit `.env` or secrets.**
- Update task status to `"shipped"` only **after** creating the PR.

## Input

Optional PR context: `$ARGUMENTS`

## Context: Current task

Run \`af state task list --json\` and find the task whose \`branch\` field matches the current branch (\`git branch --show-current\`). This is your **current task**.

If no task matches, this branch isn't linked to an aflow task — operate in ad-hoc mode without state tracking.

If a task is found, run \`af state task show --id <id> --json\` to get full details. The task has:
- \`id\` — task identifier (e.g. "t3")
- \`title\` — short description
- \`description\` — full context
- \`phase\` — understand | design | implement | verify | ship | done | cancelled
- \`spec\` — path to spec file (if exists)
- \`dependencies\` — array of task IDs that must complete before this task can start
- \`branch\` — the git branch for this task
- \`pr\` — PR URL if shipped
- \`qaResult\` — latest QA result (if any)

If the task has a spec, run \`af state spec show --id <id>\` to read it.

Also read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

**State mutations:** Use \`af state\` commands for all changes:
- \`af state task update --id <id> --field value\` — update metadata
- \`af state task transition --id <id> --phase <phase>\` — advance phase
- \`af state spec set --id <id> --file <path>\` — save spec content
- \`af state qa --id <id> --status pass|fail --summary "..."\` — record QA result

## Step 1: Pre-flight

```bash
git status
git log main..HEAD --oneline
git diff main...HEAD --stat
```

- Uncommitted changes? Ask: commit or stash?
- HEAD equals main? Stop: "Nothing to ship."
- On `main`? Stop: "Create a branch first."

## Step 2: Independent verification

Do NOT trust prior sessions. Run fresh:

```bash
bun run typecheck
bun test
bun run build
```

Fix any failures. Do not ship broken code.

## Step 3: Review the full diff

```bash
git diff main...HEAD
```

Read every line. Check for:
- **CRITICAL** — Bug, duplicate code blocks, security hole, data loss. Fix immediately.
- **ISSUE** — Real problem, not dangerous. Fix and explain.
- **SUGGESTION** — Could be better, isn't broken. Note for PR.

## Step 4: Task verification

- Read the current task from `af state`
- Are there unchecked items that this diff completes? Mark them done via `af state task update`.
- Do the acceptance criteria pass?

## Step 5: Commit

If there are uncommitted changes:
- Stage specific files — never `git add -A`
- Exclude: `.env`, `.data/`, credentials, large binaries
- Write a commit message:
  - First line: imperative, under 70 chars
  - End with `Co-Authored-By: Claude <noreply@anthropic.com>`

## Step 6: Push

```bash
git push -u origin HEAD
```

Never force-push.

## Step 7: Screenshots (if UI changes)

If the diff includes UI changes and the \`/browser\` skill is available, capture screenshots of the affected pages to include in the PR body. Save them to a temporary location and reference them in the PR.

## Step 8: Create PR

```bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-4 bullets>

## Task
- **ID:** {task id}
- **Items completed:** {count}/{total}

## Review
- Typechecked: yes
- Auto-review: <CLEAN | N issues fixed>

## Test plan
- [ ] <verification steps>

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

## Step 9: Update task

- Transition the task to shipped: `af state task update --id <id> --status shipped`
- Set the task's PR field: `af state task update --id <id> --pr '<url>'`
- Set shippedAt: `af state task update --id <id> --shippedAt '<ISO timestamp>'`

## Step 10: Report

```
## Shipped

**Task:** {id}: {title}
**Branch:** {branch}
**PR:** {url}
**Items completed:** {done}/{total}
```

