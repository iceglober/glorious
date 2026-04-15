---
name: deep-review
description: Conduct a thorough multi-agent parallel code review of the current branch's changes. Six specialized agents (Security, Data Integrity, Frontend/UX, API Contracts, Test Coverage, Logical Integrity) analyze changes simultaneously and produce a consolidated severity-grouped report. Stores findings in gs-agentic review state. Use when you want a comprehensive review before shipping.
argument-hint: "[--staged-only] [--base branch]"
disable-model-invocation: true
---

## Skill Handoff Rule

When this skill tells you to call the Skill tool, your IMMEDIATE next action MUST be that Skill tool call — no text, no summary, no confirmation.

CORRECT: Use the Skill tool with the parameter shown in the dispatch table. Your response body must be EMPTY — no text at all, only the tool call.

WRONG — these do NOTHING and the user sees a dead message:
- Outputting `/skill-name` as text — slash commands only work when the USER types them, not when you output them
- Outputting `Skill("name")` as text — this is not a tool call, it is just characters on screen
- Writing any words before, after, or instead of the tool call

### Red Flags — STOP if you are about to:
- Type a forward slash followed by a command name — that is text, not a tool call
- Write any words before the tool call — delete them, send only the tool call
- Summarize what happened before dispatching — the next skill will handle that

# Deep Review

Conduct an extremely thorough code review of the current branch's changes using 6 specialized review agents running in parallel.

**Optional arguments:** $ARGUMENTS

## Context: Current task

Run `gs-agentic state task current --json --fields id,title,phase,epic,branch,pr` to get your current task.
If exit code 1 (no task found), proceed without task context.

Also read `CLAUDE.md` for project-specific commands (typecheck, build, lint, etc.).

**State mutations:**
- `gs-agentic state review create --task <id> --source <source> --commit-sha <sha>` — create review
- `gs-agentic state review add-item --review <id> --body "..." --severity <sev> --agents <agents>` — add finding
- `gs-agentic state review list --task <id> --status open --json` — list open items
- `gs-agentic state review resolve --item <id> --status <status> --resolution "..." --commit-sha <sha>` — resolve item
- `gs-agentic state review summary --task <id> --json` — review summary counts

If a task is found, store its context (title, description, spec summary, acceptance criteria) as `TASK_CONTEXT` — this will be included in each agent's prompt so they can review against the task's intent, not just code correctness.

## Phase 1: Gather Context and Determine Diff Strategy

First, determine what to review. Run these commands to understand the current state:

```bash
git diff --cached --stat
git diff --stat
git branch --show-current
git merge-base main HEAD
```

**Diff strategy (in order of precedence):**

1. If the user passed `--staged-only`, use only staged changes: `git diff --cached`
2. If the user passed `--base <branch>`, use that as the base: `git diff <branch>...HEAD`
3. If there are staged changes, review staged changes: `git diff --cached`
4. If there are unstaged changes, review all working tree changes: `git diff`
5. If the working tree is clean, compare HEAD against the merge-base with main: `git diff $(git merge-base main HEAD)...HEAD`

Store the chosen diff command as `DIFF_CMD` for the agents to use. Also store the `--stat` output so agents know which files were touched.

Run the full diff and the stat diff so you have the complete picture before launching agents.

## Phase 2: Launch 6 Specialized Review Agents IN PARALLEL

Launch ALL 6 agents simultaneously using the Agent tool. Each agent receives the diff command, the list of changed files, AND the task context (if available). Each agent MUST use the diff command to read changes and MUST read full files for context (not just diffs).

**IMPORTANT:** Launch all 6 agents in a SINGLE message to maximize parallelism. Do NOT wait for one to finish before starting the next.

Each agent prompt should include this task context block (if a task was found):

```
TASK CONTEXT:
- Title: {task title}
- Description: {task description}
- Acceptance criteria: {from spec if available}

Review the changes against this task context — flag anything that contradicts the task's intent or misses acceptance criteria.
```

## Reference map

- **references/agent-prompts.md** — read before launching agents in Phase 2. Contains the exact prompt for each of the 6 specialized review agents.

Read `references/agent-prompts.md` now. Use the agent specifications exactly as written — one Agent tool call per agent, all 6 in a single message.

## Phase 3: Consolidate and Store Results

After ALL 6 agents complete, consolidate their findings.

### Step 1: Collect and deduplicate

Gather every finding from all 6 agents. Merge duplicates (same file+line+issue), keeping the highest severity and crediting all agents that found it.

### Step 2: Store findings in DB

If a task was found, persist the review:

```bash
# Create the review record
REVIEW_ID=$(gs-agentic state review create --task <task-id> --source deep_review \
  --commit-sha $(git rev-parse HEAD) --summary "6-agent deep review")

# For each deduplicated finding:
gs-agentic state review add-item --review $REVIEW_ID \
  --body "<finding description>" \
  --file "<path>" --line <line> \
  --severity <CRITICAL|HIGH|MEDIUM|LOW|NITPICK> \
  --agents "<comma-separated agent names>" \
  --impact "<why it matters>" \
  --suggested-fix "<how to resolve>"
```

Agent names: `security`, `data_integrity`, `frontend_ux`, `api_contracts`, `test_coverage`, `logical_integrity`.

### Step 3: Produce the report

```
## Deep Review Results

**Branch:** {branch name}
**Base:** {base reference}
**Task:** {task id}: {task title} (or "No task" if ad-hoc)
**Files reviewed:** {count}
**Summary:** {X critical, Y high, Z medium, W low, V nitpick}

### Findings

| # | Severity | Finding | File | Agent |
|---|----------|---------|------|-------|
| 1 | CRITICAL | Description | path:line | Security |
| 2 | HIGH     | Description | path:line | Data Integrity |
| ... | ... | ... | ... | ... |

### Actionable Items (CRITICAL + HIGH)

These MUST be addressed before merging:

1. **[CRITICAL]** Finding description
   - File: `path/to/file.ts:123`
   - Fix: Suggested resolution
   - Found by: Agent name

### Recommendations (MEDIUM)

These SHOULD be addressed:

1. ...

### Informational (LOW + NITPICK)

Nice-to-have improvements:

1. ...

### Agent Notes

Brief summary from each agent:
- **Security:** {1-2 sentence summary}
- **Data Integrity:** {1-2 sentence summary}
- **Frontend/UX:** {1-2 sentence summary}
- **API Contracts:** {1-2 sentence summary}
- **Test Coverage:** {1-2 sentence summary}
- **Logical Integrity:** {1-2 sentence summary}
```

### Step 4: Final verdict and next steps

End with one of:
- **SHIP IT** -- No critical or high findings. Code is ready to merge.
- **NEEDS FIXES** -- Has high/critical findings that must be addressed.
- **STOP** -- Has critical issues that indicate fundamental problems with the approach.

Then ask the user what to do next based on the verdict:

**If SHIP IT:**

Use the AskUserQuestion tool:

```
question: "Review clean — no critical or high findings. What's next?"
header: "Next step"
options:
  1. label: "QA (Recommended)", description: "Run QA against the task's acceptance criteria"
  2. label: "Ship it", description: "Typecheck, commit, push, and create a PR"
  3. label: "Done for now", description: "Stop here — come back later"
```

## DISPATCH — Execute IMMEDIATELY after user responds

| User selects | YOUR ACTION (tool call, not text) |
|---|---|
| "QA (Recommended)" | Call Skill tool → skill: "qa" |
| "Ship it" | Call Skill tool → skill: "ship" |
| "Done for now" | stop |
| Other (free text) | the user is giving direction — follow their instructions |

**CONSTRAINT:** Your response after the user answers MUST contain ONLY the Skill tool call — no text whatsoever.

WRONG: outputting `/qa` or any slash command as text (does nothing)
WRONG: any words before or instead of the tool call
CORRECT: a single Skill tool call as the entire response

**If NEEDS FIXES or STOP:**

Use the AskUserQuestion tool:

```
question: "Review found issues that need addressing. What's next?"
header: "Next step"
options:
  1. label: "Plan the fixes (Recommended)", description: "Create a structured fix plan with /deep-plan"
  2. label: "QA anyway", description: "Run QA to see full acceptance criteria status"
  3. label: "Ship anyway", description: "Skip unresolved CRITICAL/HIGH findings — typecheck, commit, push, and create a PR"
  4. label: "Done for now", description: "Stop here — address findings later"
```

## DISPATCH — Execute IMMEDIATELY after user responds

| User selects | YOUR ACTION (tool call, not text) |
|---|---|
| "Plan the fixes (Recommended)" | Call Skill tool → skill: "deep-plan", args: "<one-line summary of each CRITICAL and HIGH finding: severity, file:line, description>" |
| "QA anyway" | Call Skill tool → skill: "qa" |
| "Ship anyway" | Call Skill tool → skill: "ship" |
| "Done for now" | stop |
| Other (free text) | the user is giving direction — follow their instructions |

**CONSTRAINT:** Your response after the user answers MUST contain ONLY the Skill tool call — no text whatsoever.

WRONG: outputting `/deep-plan` or any slash command as text (does nothing)
WRONG: any words before or instead of the tool call
CORRECT: a single Skill tool call as the entire response

Do NOT auto-fix. Wait for the user's choice.
