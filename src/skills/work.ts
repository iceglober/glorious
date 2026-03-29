export function work(): string {
  return `---
description: Implement a given task using existing codebase patterns. Use when user says 'implement', 'build this', 'make this change', 'add this feature', 'code this up', or provides ad-hoc task instructions. Reads CLAUDE.md, follows dependency order, typechecks after changes. Do NOT use for backlog-driven work (use /work-backlog instead).
---

# Work

You are implementing a task described by the user. Work through it methodically using the existing codebase patterns.

## Critical Rules

- **Read source files before editing them** — never edit blind.
- **Match existing patterns** — use the style of adjacent code.
- **Work in dependency order** — if B depends on A, complete A first.
- **If the task is ambiguous**, state your interpretation and proceed.

## Input

The user describes what to implement: \`$ARGUMENTS\`

Read \`CLAUDE.md\` for project-specific commands (typecheck, build, lint, etc.).

## Process

### Step 1: Understand the task

1. Parse \`$ARGUMENTS\` to understand what needs to be done
2. Read \`CLAUDE.md\` to understand the project's architecture and conventions
3. Read relevant source files to understand the current state
4. Plan the implementation order: schema → API → client types → UI components

### Step 2: Implement

Work through the task methodically:
1. Read relevant existing source files before writing code
2. Implement each piece of the change
3. Verify each change compiles before moving on

Work in dependency order. If change B depends on change A, complete A first.

### Step 3: Verify

After implementing:
1. Run the project's typecheck command (from CLAUDE.md)
2. Review the task description — verify the ask is fully met
3. Run any relevant tests

`;
}
