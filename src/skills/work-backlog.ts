import { TASK_PREAMBLE } from "./preamble.js";

export function workBacklog(): string {
  return `---
description: Work through the current task from the aflow backlog. Use when user says 'work on the current task', 'continue the backlog task', 'check off items', 'next item', or invokes from the aflow TUI. Reads task from .aflow/backlog.json, implements unchecked items, marks them done. Do NOT use for ad-hoc tasks without a backlog entry (use /work instead).
---

# Work Backlog

You are implementing the current aflow task from the backlog, working through its checklist items.

## Critical Rules

- **Mark items done one at a time** as you complete them, not all at the end.
- **Read source files before editing them.**
- **Do NOT mark items done that you didn't implement.**
- **Do not modify other tasks** in the backlog.
- If you discover work with no corresponding item, **add a new item** to the task's \`items\` array first, then implement it.

## Input

Optional focus or section to work on: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Process

### Step 1: Scope the work

1. Read the current task's \`items\` array — identify all unchecked items (\`done: false\`)
2. Read the \`acceptance\` criteria for full context on what "done" means
3. Read relevant source files to understand the current state
4. Plan the implementation order: schema → API → client types → UI components

If \`$ARGUMENTS\` specifies a focus area, only work on items matching that scope.

### Step 2: Implement

For each unchecked item:
1. Read relevant existing source files before writing code
2. Implement the feature/change
3. Mark the item as done in \`.aflow/backlog.json\` immediately:
   - Find the task, find the item by text, set \`done: true\`
   - Write the updated backlog back to \`.aflow/backlog.json\`
4. Move to the next item

Work through items in dependency order. If item B depends on item A, complete A first.

### Step 3: Verify

After completing items:
1. Run the project's typecheck command (from CLAUDE.md)
2. Review the acceptance criteria — verify each is met
3. Ensure every completed item is marked done in the backlog
4. Do NOT mark items done that you didn't implement

`;
}
