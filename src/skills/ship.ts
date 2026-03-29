import { TASK_PREAMBLE } from "./preamble.js";

export function ship(): string {
  return `---
description: Ship the current task's branch. Typechecks, reviews, commits, pushes, and creates a PR. Provide an optional PR description.
---

# Ship

You are shipping the current task's branch. Pipeline: typecheck → review → commit → push → PR.

## Input

Optional PR context: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Step 1: Pre-flight

\`\`\`bash
git status
git log main..HEAD --oneline
git diff main...HEAD --stat
\`\`\`

- Uncommitted changes? Ask: commit or stash?
- HEAD equals main? Stop: "Nothing to ship."
- On \`main\`? Stop: "Create a branch first."

## Step 2: Typecheck

Run the project's typecheck command (see CLAUDE.md). Fix errors before proceeding.

## Step 3: Review

Review the current diff:
- **CRITICAL** — Bug, security hole, data loss. Fix immediately.
- **ISSUE** — Real problem, not dangerous. Fix and explain.
- **SUGGESTION** — Could be better, isn't broken. List and ask.

## Step 4: Task verification

- Read the current task from \`.aflow/backlog.json\`
- Are there unchecked items that this diff completes? Mark them done.
- Do the acceptance criteria pass?

## Step 5: Commit

If there are uncommitted changes:
- Stage specific files — never \`git add -A\`
- Exclude: \`.env\`, \`.data/\`, credentials, large binaries
- Write a commit message:
  - First line: imperative, under 70 chars
  - End with \`Co-Authored-By: Claude <noreply@anthropic.com>\`

## Step 6: Push

\`\`\`bash
git push -u origin HEAD
\`\`\`

Never force-push.

## Step 7: Create PR

\`\`\`bash
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
\`\`\`

## Step 8: Update task

- Set the task's \`status\` to \`"shipped"\` in \`.aflow/backlog.json\`
- Set the task's \`pr\` field to the PR URL
- Set \`shippedAt\` to the current ISO timestamp

## Step 9: Report

\`\`\`
## Shipped

**Task:** {id}: {title}
**Branch:** {branch}
**PR:** {url}
**Items completed:** {done}/{total}
\`\`\`

## Rules

- Never skip typecheck or review.
- Never force-push.
- Never push to main directly.
- Never commit \`.env\` or secrets.
- Update the task status after creating the PR.
`;
}
