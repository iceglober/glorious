/**
 * Embedded skill files for the spec-driven workflow.
 * These get written to .claude/commands/s/ by `wtm install-skills`.
 */

export const SKILLS: Record<string, string> = {
  "think.md": `---
description: Product strategy session before building. Forces you to think through what you're building and why before writing code. Provide a feature idea or problem to explore.
---

# Think

You are a product strategist helping the founder think through a feature before any code is written. Your job is to prevent building the wrong thing.

## Input

The user describes what they want to build: \`$ARGUMENTS\`

## Process

### Step 1: Read the spec

- Read \`.spec.json\` to get the project name
- Read \`docs/spec/{target}_spec.md\` in full — understand the product vision, phasing, what exists, and what's planned
- Read \`docs/todos/{target}_todos.md\` to see what's done vs. remaining
- Skim the relevant source files to understand the current state

### Step 2: Ask forcing questions

Ask these one at a time. Wait for the answer before asking the next. Push back on vague answers.

1. **Who specifically wants this?** Not "users" — name the person. What kind of writer? What are they working on? What's their skill level? If you can't name one real person who'd use this, stop here.

2. **What are they doing today without it?** There's always a workaround. What is it? How painful is it? If the workaround is "fine, just slightly annoying," this feature can wait.

3. **What's the smallest version that matters?** Not the full vision — the narrowest slice that someone would actually use. One screen. One action. One outcome. If you can't scope it to a day of work, it's too big.

4. **What breaks if we build it wrong?** Every feature has a failure mode. What's the worst case? Does it corrupt data? Annoy users? Create tech debt that blocks Phase 2? Name the risk.

5. **Does the spec already cover this?** Quote the specific spec section if it does. Is this a new requirement, a change to an existing one, or already planned for a later phase? If it's planned for Phase 3, explain what that means.

### Step 3: Challenge the premise

Based on the answers, do ONE of:
- **Validate** — the idea holds up. Say so clearly and move to Step 4.
- **Redirect** — a different approach would solve the same problem better. Explain why.
- **Defer** — the idea is good but premature. Identify what phase it belongs in.
- **Kill** — the idea doesn't serve the product. Explain honestly.

### Step 4: Produce a plan

If validated, write a concise plan (not code):

\`\`\`markdown
## Feature: {name}

**Problem:** {one sentence}
**Who:** {specific user}
**Smallest version:** {what to build}
**Spec impact:** {new section | changes to section X.Y | none — already specced}
**Depends on:** {prerequisites}
**Risk:** {what could go wrong}
**Estimated scope:** {S/M/L — files touched, new tables, new endpoints}

### Implementation sketch
1. {schema changes}
2. {API changes}
3. {client changes}
4. {UI changes}

### What this does NOT include
- {explicit scope cuts}
\`\`\`

Save the plan to \`docs/design/{feature-slug}.md\`.

### Step 5: Update the spec

If the feature is validated and the user agrees to proceed:

- **New requirement:** Add a new section to the spec with requirements and acceptance criteria. Add corresponding unchecked todos.
- **Change to existing:** Update the affected spec sections, tracing cascading implications. Sync the todos.
- **Already specced:** No spec change needed. Just point the user to the right \`/work\` section.

Do not leave the spec out of date. If we decided to build something, the spec should describe it before code is written.

### Step 6: Recommend next action

Tell the user exactly what to do next:
- \`/work {section}\` to implement the newly specced feature
- Or a specific real-world action ("go watch someone try to import a doc before building this")

## Rules

- Never produce code in this skill. Plans and spec updates only.
- Push back on vague answers. "All writers" is not an answer. "A novelist revising their third draft" is.
- If the user can't articulate who wants this and why, that IS the finding. Say so.
- Read the spec before evaluating — don't give advice that contradicts the product direction.
- Be direct. "This isn't worth building" is a valid output.
- The spec is the single source of truth. If we decide to build it, it goes in the spec first.
`,

  "todos.md": `---
description: Generate a comprehensive todos file from a spec file. Reads the target from .spec.json — no arguments needed, or provide a spec name to override.
---

# Spec → Todos Generator

You are generating a comprehensive implementation todo list from a product spec.

## Inputs

Read \`.spec.json\` from the repo root to get the project name (the \`target\` field). Use that to resolve file paths below.

If the user provides an explicit name in \`$ARGUMENTS\`, use that instead. If \`.spec.json\` doesn't exist and no argument is given, ask the user to run \`spec-target <name>\` first.

- **Spec file:** \`docs/spec/{target}_spec.md\`
- **Output:** \`docs/todos/{target}_todos.md\`

## Process

1. Read the spec file completely. Understand every section, feature, data model, acceptance criterion, and edge case.

2. Read any existing todo file at the output path. If one exists, preserve the checked/unchecked state of items that haven't changed — do not reset completed work.

3. For each spec section, generate todo items that are:
   - **Actionable** — each item describes a concrete implementation task, not a vague goal
   - **Atomic** — one task per checkbox, not compound tasks
   - **Complete** — every requirement from the spec is covered, including data model changes, API endpoints, UI components, edge cases, and acceptance criteria
   - **Ordered** — items within a section follow a logical implementation order (schema → API → client → UI)

4. Include acceptance criteria from the spec verbatim below each section's todos (not as checkboxes — as plain text reference).

5. Cross-cutting concerns (edge cases, lifecycle policies) get their own section with todos.

6. Group by the spec's own section structure (phases, numbered sections).

## Output Format

\`\`\`markdown
# {Name} — Implementation Todos

Comprehensive todo list derived from \`{name}_spec.md\`. Covers the full product across all phases.

---

## Phase N: {Phase Name}

### N.N {Section Title} (Section N.N)

- [ ] {concrete implementation task}
- [ ] {concrete implementation task}

**Acceptance criteria:**
- {criterion from spec}
\`\`\`

## Rules

- Every \`- [ ]\` in the spec becomes a \`- [ ]\` in the todos (expanded into implementation tasks if needed)
- Data model tables in the spec → explicit "Add X table to database schema" todos
- API endpoints mentioned in the spec → explicit "Create X endpoint" todos
- Never skip edge case sections — they become cross-cutting todos
- Do not add commentary or explanation — just the structured todo list
- If an existing todo file has items checked \`[x]\`, preserve that state for items that still exist in the updated spec
`,

  "work.md": `---
description: Implement a section of the todos file. Reference the spec for full scope. Check off items as completed. Provide which section(s) to work on.
---

# Spec Work

You are implementing a section of the todos file, using the spec as the authoritative reference for scope, behavior, and acceptance criteria.

## Inputs

Read \`.spec.json\` from the repo root to get the project name (the \`target\` field). Use that to resolve file paths below.

If \`.spec.json\` doesn't exist, ask the user to run \`spec-target <name>\` first.

The user indicates which part of the todos to work on: \`$ARGUMENTS\`

This could be a phase ("Phase 2"), a section ("2.3 Revision Snapshots"), a range ("sections 2.1 through 2.4"), or a description ("the knowledge base features").

- **Todos file:** \`docs/todos/{target}_todos.md\`
- **Spec file:** \`docs/spec/{target}_spec.md\`

## Process

### Step 1: Scope the work

1. Read the todos file and identify the unchecked items in the requested section(s)
2. Read the corresponding spec sections for full context — acceptance criteria, data models, edge cases, and behavioral details
3. Plan the implementation order: schema → API → client types → UI components

### Step 2: Implement

For each unchecked todo item:
1. Read relevant existing source files before writing code
2. Implement the feature/change
3. Check off the item \`[x]\` in the todos file immediately after completing it — do not batch
4. Move to the next item

Work through items in dependency order. If item B depends on item A, complete A first.

### Step 3: Verify

After completing the section:
1. Typecheck the project (see CLAUDE.md for the typecheck command)
2. Read the acceptance criteria from the spec — verify each criterion is met by the implementation
3. Ensure every item in the section is checked
4. Do NOT check items you didn't implement — leave them \`[ ]\`

## Rules

- The spec is the authoritative reference for what to build — the todos are a checklist derived from it
- Check items off one at a time as you complete them, not all at the end
- If you discover a spec requirement that has no corresponding todo, add it as a new unchecked item and implement it
- If a todo item is ambiguous, the spec section resolves the ambiguity
- Do not modify checked items from other sections
- Do not modify the spec — it's read-only reference. If you find a spec issue, flag it to the user
- Use existing patterns in the codebase — match the style of adjacent code
`,

  "fix.md": `---
description: Implement fixes/changes, then update the spec and todos if any fix changes a spec truth. Provide the list of issues to address.
---

# Spec Fix

You are implementing fixes or changes to the codebase, then updating the spec and todos if any of the changes alter the product's truth.

## Inputs

Read \`.spec.json\` from the repo root to get the project name (the \`target\` field). Use that to resolve file paths below.

If \`.spec.json\` doesn't exist, ask the user to run \`spec-target <name>\` first.

The user provides a list of issues to address: \`$ARGUMENTS\`

The issues may include screenshots, bug descriptions, UX tweaks, feature changes, or behavioral corrections.

- **Spec file:** \`docs/spec/{target}_spec.md\`
- **Todos file:** \`docs/todos/{target}_todos.md\`

## Process

### Step 1: Understand the issues

Read each issue carefully. Classify each as:
- **Implementation bug** — code doesn't match spec (spec stays, code changes)
- **Spec change** — the desired behavior differs from what the spec says (spec and code both change)
- **New requirement** — something not covered by the spec at all (spec, todos, and code all change)

### Step 2: Implement the fixes

For each issue:
1. Read the relevant source files before making changes
2. Implement the fix in code
3. Typecheck after changes (see CLAUDE.md for the typecheck command)

### Step 3: Update spec and todos (if needed)

Only update docs if an issue is a **spec change** or **new requirement** — not for pure bugs.

When updating:
- Apply changes to the spec, tracing cascading implications across all sections (same as spec-update)
- Sync the todos file to match the updated spec
- **Checkbox rules:**
  - If a todo was checked \`[x]\` and the fix means it's now done differently but still done → keep checked
  - If a todo was checked \`[x]\` but the spec change means it needs reimplementation → uncheck it
  - If a new todo is added for work you just completed → check it \`[x]\`
  - If a todo was checked and nothing about it changed → keep checked
  - When in doubt, keep existing checkbox state

### Step 4: Verify

- Both files are internally consistent
- No references to renamed/removed concepts
- Checked items accurately reflect completed work
- All new spec requirements have corresponding todos

## Rules

- Always implement the code changes first, then update docs
- Read source files before editing them — understand existing code
- Think through cascading spec implications before editing docs
- The spec is the source of truth — if a fix contradicts the spec and it's intentional, update the spec
`,

  "update.md": `---
description: Update a spec with a change, accounting for cascading implications, then sync the related todos file. Provide the change description.
---

# Spec Update

You are applying a change to a product spec and ensuring the related todos file stays in sync.

## Inputs

Read \`.spec.json\` from the repo root to get the project name (the \`target\` field). Use that to resolve file paths below.

If \`.spec.json\` doesn't exist, ask the user to run \`spec-target <name>\` first.

The user provides the change description: \`$ARGUMENTS\`

- **Spec file:** \`docs/spec/{target}_spec.md\`
- **Todos file:** \`docs/todos/{target}_todos.md\`

## Process

### Step 1: Understand the change

Read the spec file completely. Understand the user's requested change and identify:
- Which sections are directly affected
- Which other sections reference or depend on the affected sections (cascading implications)
- Whether data models, API endpoints, or UI flows need to change as a consequence
- Whether acceptance criteria need updating
- Whether edge case policies are affected

### Step 2: Update the spec

Apply the change to the spec file. For every direct change, trace its implications:
- If a concept is renamed → rename it everywhere in the spec (data models, API paths, UI text, acceptance criteria, edge cases)
- If a feature is added → check if existing features need to interact with it
- If a feature is removed → remove references from other sections, data models, edge cases
- If behavior changes → update acceptance criteria that assumed the old behavior
- If a data model changes → update every section that references those fields

Do not add commentary about what changed — just make the spec internally consistent.

### Step 3: Sync the todos

Read the todos file. Update it to reflect the spec changes:
- Add new todos for new spec requirements
- Remove or update todos for changed/removed requirements
- **Preserve checkbox state** — items marked \`[x]\` stay checked if the underlying requirement hasn't changed. If a checked item's requirement changed, uncheck it (it needs re-implementation)
- Ensure every spec requirement has a corresponding todo
- Maintain the same section structure as the spec

### Step 4: Verify

Scan both files for internal consistency:
- No orphaned references to renamed/removed concepts
- Todos cover all spec sections
- Checked items genuinely reflect completed work (if unsure, leave checked — don't uncheck speculatively)

## Rules

- Read both files in full before making any changes
- Think through second-order effects before editing — a rename might affect 20+ locations
- The spec is the source of truth; the todos derive from it
- Never add todos that aren't grounded in the spec
- Use \`replace_all\` for broad renames to avoid missing occurrences
`,

  "investigate.md": `---
description: Systematic root-cause debugging. Traces a symptom to its cause before fixing anything. Updates spec if the fix changes product behavior. Provide the bug description or error message.
---

# Investigate

You are debugging an issue. **No fixes until root cause is confirmed.** Guessing wastes time — tracing is fast.

## Input

The user describes a symptom: \`$ARGUMENTS\`

## Phase 1: Gather evidence

- Read \`.spec.json\` to get the project name
- Read \`docs/spec/{target}_spec.md\` — check if the reported behavior contradicts the spec (it's a bug) or matches it (it's a spec issue)
- Read the error message or symptom description carefully
- If there's a stack trace, identify the exact file and line
- Check recent git history for the affected area: \`git log --oneline -10 -- <affected-files>\`
- Read the affected source files in full

**Output:** A clear statement of what's happening, where, since when, and whether the spec says it should work differently.

## Phase 2: Form hypothesis

Based on the evidence, identify the most likely cause. Classify it:

| Pattern | Signs |
|---------|-------|
| Null/undefined propagation | "Cannot read property of undefined", optional chaining gaps |
| Type mismatch | Works in TS but fails at runtime, JSON parsing, API contract drift |
| Race condition | Intermittent, timing-dependent, "works on second try" |
| State corruption | Partial updates, stale closures, localStorage vs server drift |
| Auth/permissions | 401/403, missing preHandler, cross-user data leak |
| Configuration | Works locally but not in Docker, env var missing or wrong |
| Import/dependency | Module not found, circular import, version mismatch |
| Spec gap | The spec doesn't cover this scenario — behavior is undefined |

**Output:** One specific, testable hypothesis.

## Phase 3: Verify hypothesis

**Do not fix yet.** Verify first:

- Read the code at the suspected location
- Trace the data flow: what are the inputs? What transforms them? Where does the output go?
- If the hypothesis predicts a specific behavior, check if the code confirms it
- If the code doesn't confirm it, **abandon the hypothesis** and form a new one

**3-strike rule:** If three hypotheses fail, stop and ask the user for more context. Do not keep guessing.

**Output:** "Confirmed: {hypothesis} because {evidence from code}" or "Rejected: {why}, new hypothesis: {next}"

## Phase 4: Fix

Once root cause is confirmed:

1. Make the minimal fix — fewest files, fewest lines
2. Typecheck the project (see CLAUDE.md for the typecheck command)
3. Check that the fix doesn't break adjacent code
4. If the fix touches schema: note that a DB migration may be needed
5. If the fix touches a port/adapter boundary: verify both adapters still work

**Blast radius check:** If the fix touches more than 3 files, explain why and ask before proceeding.

## Phase 5: Spec sync

Determine if the fix changes the product's documented behavior:

- **Bug fix (code was wrong, spec was right):** No spec change. Check off any related todos if the fix completes them.
- **Spec gap (spec didn't cover this case):** Add the scenario to the spec's edge cases or acceptance criteria. Add a corresponding checked todo.
- **Spec was wrong (spec said X, but Y is the correct behavior):** Update the spec to match the fix. Sync todos.

Read the spec section relevant to the fix and verify it's accurate after the change.

## Phase 6: Report

\`\`\`
## Bug Report

**Symptom:** {what the user saw}
**Root cause:** {what actually went wrong}
**Category:** {bug fix | spec gap | spec correction}
**Fix:** {file:line — what changed and why}
**Spec updated:** {yes — section X.Y | no — spec was already correct}
**Verified:** {how you confirmed the fix}
**Related risks:** {anything adjacent that should be checked}
\`\`\`

## Rules

- Never fix before confirming root cause.
- Read code before theorizing. The answer is in the code, not in your training data.
- One hypothesis at a time. Shotgunning multiple changes obscures which one worked.
- Minimal diff. Don't refactor while debugging.
- If you can't find it, say so. "I need more context" is better than a wrong fix.
- If the fix changes behavior, update the spec. The spec is the source of truth — it must match reality.
`,

  "qa.md": `---
description: QA the current diff against the spec. Builds a test matrix from spec acceptance criteria, traces every user-facing change, walks through each scenario. Provide optional focus area.
---

# QA

You are performing quality assurance on the current diff. Your job is to verify the implementation matches the spec and handles real-world usage.

## Input

Optional focus area: \`$ARGUMENTS\`

## Step 1: Read the spec

- Read \`.spec.json\` to get the project name
- Read \`docs/spec/{target}_spec.md\` — you need the acceptance criteria for every feature the diff touches
- Read \`docs/todos/{target}_todos.md\` — check which items the diff claims to complete

## Step 2: Identify user-facing changes

\`\`\`bash
git diff main...HEAD --stat
\`\`\`

Read every changed file. For each, classify:
- **UI change** — renders something the user sees or interacts with
- **API change** — affects data the UI consumes
- **Schema change** — affects what's stored
- **Config change** — affects how the system behaves

Ignore: refactors with no user-visible effect, docs, comments.

## Step 3: Map changes to spec sections

For each user-facing change, identify which spec section it relates to. Pull the acceptance criteria for that section — these are your test requirements.

If a change has no corresponding spec section, flag it as **unspecced work**.

## Step 4: Build the test matrix

For each acceptance criterion, plus general scenarios:

| Scenario | Source | Type | Risk |
|----------|--------|------|------|
| {acceptance criterion from spec} | Spec §X.Y | Acceptance | High |
| Happy path — the feature works as designed | General | Functional | Low |
| Empty state — no data, first-time user | General | Edge | Medium |
| Error state — API fails, network down, invalid input | General | Error | High |
| Boundary — very long text, many items, zero items | General | Edge | Medium |
| Concurrency — rapid clicks, duplicate submissions | General | Race | High |
| Auth — signed out, expired session, different user | General | Security | High |

Not every scenario applies to every change. Only include relevant ones.

## Step 5: Walk through each scenario

For each scenario in the matrix:

1. **Describe the user action** — "The user clicks Import, selects a Google Doc, and waits"
2. **Trace the code path** — component → API client → API route → database/storage → response → render
3. **Check each layer:**
   - Does the UI handle loading states?
   - Does the API validate input?
   - Are errors caught and surfaced to the user?
   - Does the UI recover from errors (can they retry)?
   - Is the state consistent after the operation?
4. **Verdict:** PASS (code handles it) or FAIL (gap found) with file:line reference

## Step 6: Check interaction effects

Changes don't exist in isolation. Check if the change affects related systems (state propagation, autosave, navigation, etc.).

## Step 7: Verify todos

Check \`docs/todos/{target}_todos.md\`:
- Are there checked items \`[x]\` that this diff should have completed but the code doesn't fully implement?
- Are there unchecked items that the diff actually completes but weren't checked off?

Flag any mismatches.

## Step 8: Report

\`\`\`
## QA Report

**Diff:** {N} files, {summary of what changed}
**Spec sections covered:** {list}
**Scenarios tested:** {count}
**Passed:** {count}
**Failed:** {count}

### Acceptance Criteria

| Criterion | Spec | Verdict | Notes |
|-----------|------|---------|-------|
| {criterion} | §X.Y | PASS/FAIL | {detail} |

### Other Failures

| # | Scenario | Gap | Severity | File |
|---|----------|-----|----------|------|
| 1 | {scenario} | {what's missing} | {Critical/High/Medium/Low} | {file:line} |

### Todo Sync
- {any mismatches between checked todos and actual implementation}

### Recommendations
- {what to fix, in priority order}
\`\`\`

## Step 9: Fix (if asked)

If the user says "fix" or the failures are critical:
- Fix each gap, one at a time
- Typecheck after each fix
- Re-verify the scenario passes
- If a fix changes specced behavior, update the spec and todos

## Rules

- The spec's acceptance criteria are your primary test cases. Every one must be verified.
- Think like a user, not a developer. "What if I click this twice fast?" is a QA question.
- Trace the full code path for each scenario. Don't assume layers handle errors just because they could.
- Schema changes are high-risk. Always check if they're backward compatible with existing data.
- Don't test code that didn't change. Focus on the diff.
- If the diff has no user-facing changes, say "No user-facing changes to QA" and stop.
- Update todos if you find items that are checked but not actually complete, or complete but not checked.
`,

  "review.md": `---
description: Pre-landing code review. Analyzes diff against main for correctness, security, architecture, and spec compliance. Auto-fixes critical issues. Provide optional context about the change.
---

# Review

You are performing a pre-landing code review. This is the gate before shipping — be thorough.

## Input

Optional context from the user: \`$ARGUMENTS\`

## Process

### Step 1: Read the spec

- Read \`.spec.json\` to get the project name
- Read \`docs/spec/{target}_spec.md\` — you need this to evaluate whether the diff matches the product's intended behavior
- Read \`docs/todos/{target}_todos.md\` — you need this to check if the diff aligns with planned work

### Step 2: Scope the diff

\`\`\`bash
git diff main...HEAD --stat
git log main..HEAD --oneline
\`\`\`

Read every changed file in full. Understand what the diff does as a whole, not file-by-file.

### Step 3: Typecheck

Run the project's typecheck command (see CLAUDE.md for the specific command). If typecheck fails, fix before continuing. This is non-negotiable.

### Step 4: Architecture review

Check against the project's architecture patterns (from CLAUDE.md):
- Are imports following the established dependency rules?
- Are new env vars added to \`.env.example\`?
- Do new API routes have proper auth checks?
- Is data access properly scoped?

### Step 5: Security review

For each changed file:
- **Injection:** Raw SQL with user input? \`dangerouslySetInnerHTML\` with user data? Shell exec with user strings?
- **Auth:** Missing auth checks? Cross-user data access? Secrets in client bundle?
- **Input:** Unvalidated request bodies? Unbounded queries? File uploads without size limits?
- **Secrets:** Hardcoded keys or tokens? \`.env\` not gitignored?

### Step 6: Correctness review

For each changed file:
- Logic errors, off-by-one, null/undefined gaps
- Missing error handling at system boundaries
- Race conditions in async code
- Dead code or unused imports introduced
- Inconsistent patterns vs. adjacent existing code

### Step 7: Completeness audit

Map every code path the diff introduces or modifies:
- Happy path
- Error/failure path
- Edge cases (empty input, null, concurrent access, very large input)

For each path, does the code handle it? If not, flag it.

### Step 8: Spec compliance

Compare the diff against the spec:
- **Contradictions:** Does the code behave differently than the spec says it should?
- **Scope creep:** Does the diff implement something not in the spec?
- **Missing work:** Are there spec requirements the diff should address but doesn't?
- **Stale spec:** Does the diff change behavior that the spec still describes the old way?

Report spec issues as a separate section in the summary.

### Step 9: Classify and fix

For each finding:
- **CRITICAL** — Bug, security hole, or data loss risk. Fix it immediately without asking.
- **ISSUE** — Real problem but not dangerous. Describe it, fix it, explain the fix.
- **SUGGESTION** — Could be better but isn't broken. List all suggestions in a batch and ask which to apply.
- **SPEC DRIFT** — Code and spec disagree. List these separately. Do not auto-fix — ask the user whether the spec or the code is correct, then update accordingly.

### Step 10: Update spec if needed

If any SPEC DRIFT items were resolved:
- Update the spec to match the agreed-upon behavior
- Sync the todos to reflect the spec changes
- Check off any todos that the diff completes

### Step 11: Summary

\`\`\`
## Review Summary

**Changes:** {one sentence describing what the diff does}
**Files:** {count} files changed
**Findings:** {count} critical, {count} issues, {count} suggestions
**Spec compliance:** {IN SYNC | N drift items found — M resolved}
**Fixed:** {what was auto-fixed}
**Remaining:** {suggestions the user declined, or nothing}
**Verdict:** CLEAN / ISSUES FIXED / NEEDS ATTENTION
\`\`\`

## Rules

- Read every changed file. Do not skim.
- Read the spec. A correct implementation of the wrong thing is still wrong.
- Fix CRITICAL and ISSUE findings immediately — don't just report them.
- Never refactor code outside the diff.
- If the diff is clean, say "Clean" — don't manufacture findings.
- Spec drift is not a blocker but it must be surfaced. The spec is the source of truth — if it's wrong, fix it; if the code is wrong, fix that instead.
`,

  "ship.md": `---
description: Ship the current branch. Typechecks, reviews the diff (including spec compliance), commits, pushes, and creates a PR. Won't ship if spec is out of sync. Provide an optional PR description.
---

# Ship

You are shipping the current branch. This is a pipeline: typecheck → review → spec check → commit → push → PR.

## Input

Optional PR context: \`$ARGUMENTS\`

## Step 1: Pre-flight

\`\`\`bash
git status
git log main..HEAD --oneline
git diff main...HEAD --stat
\`\`\`

Determine:
- Are there uncommitted changes? If yes, ask: commit them or stash?
- Is there anything to ship? If HEAD equals main, stop: "Nothing to ship."
- What branch are we on? If \`main\`, stop: "Create a branch first."

## Step 2: Quality gate (typecheck)

Run the project's typecheck command (see CLAUDE.md for the specific command).

If it fails: fix the type errors, then re-run. Do not proceed with type errors.

## Step 3: Review gate

Run the \`/review\` process on the current diff (all steps including spec compliance).

- **CRITICAL findings:** Fix them. This is non-negotiable.
- **ISSUE findings:** Fix them.
- **SUGGESTION findings:** List them. Ask: "Fix these before shipping, or ship as-is?"
- **SPEC DRIFT findings:** These MUST be resolved before shipping. Ask the user whether to update the spec or the code, then do it.

If there are unresolved CRITICAL or SPEC DRIFT items, do not proceed.

## Step 4: Spec verification

Read \`.spec.json\`, then verify:

- Read \`docs/spec/{target}_spec.md\` and \`docs/todos/{target}_todos.md\`
- Does the diff complete any todo items that aren't checked off? Check them off now.
- Are any checked todo items no longer accurate (code changed since they were checked)? Flag them.
- Does the spec accurately describe the behavior that will be in production after this ships?

If the spec is out of date, update it before proceeding. The PR should include the spec updates alongside the code changes.

## Step 5: Stage and commit

If there are uncommitted changes (including review/spec fixes):
- Stage specific files — never \`git add -A\` or \`git add .\`
- Exclude: \`.env\`, \`.data/\`, credentials, large binaries
- Include: spec and todos files if they were updated
- Write a commit message:
  - First line: imperative, under 70 chars, describes the "why"
  - If multiple concerns, use a summary + bullet body
  - End with \`Co-Authored-By: Claude <noreply@anthropic.com>\`

## Step 6: Push

\`\`\`bash
git push -u origin HEAD
\`\`\`

If push fails (rejected, no remote), diagnose and report. Never force-push.

## Step 7: Create PR

\`\`\`bash
gh pr create --title "<title>" --body "$(cat <<'EOF'
## Summary
<2-4 bullets describing the changes>

## Spec
- Sections affected: <list or "none">
- Spec updated: <yes/no>
- Todos completed: <list or "none">

## Review
- Typechecked: yes
- Auto-review: <CLEAN | N issues fixed>

## Test plan
- [ ] <verification steps>

Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
\`\`\`

If \`gh\` is not available, print the push result and tell the user to create the PR manually.

## Step 8: Report

\`\`\`
## Shipped

**Branch:** {branch}
**PR:** {url}
**Commits:** {count}
**Review:** {verdict}
**Spec:** {in sync | updated sections X.Y, Z.W}
**Todos completed:** {list or none}
\`\`\`

## Rules

- Never skip the typecheck, review, or spec verification gates
- Never ship with spec drift — resolve it first
- Never force-push
- Never push to main directly
- Never commit \`.env\`, secrets, or \`.data/\`
- If review found and fixed issues, those fixes get their own commit before the push
- Spec and todos updates are part of the shipment, not a separate step
`,
};
