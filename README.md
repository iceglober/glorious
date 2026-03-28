# aflow

Structured AI workflows for product and engineering. Two skill pipelines — one for turning ideas into specs, one for turning specs into code — powered by Claude Code.

## Getting Started

### Install

Requires Node.js 20+ and the [GitHub CLI](https://cli.github.com).

```bash
curl -fsSL https://raw.githubusercontent.com/iceglober/aflow/main/install.sh | bash
```

### Initialize skills

Install aflow skills as Claude Code slash commands in your repo:

```bash
af skills
```

Or install globally (available in every repo):

```bash
af skills --user
```

This gives you two skill pipelines:

| Pipeline | Skills | Purpose |
|----------|--------|---------|
| **Product** | `/prod:research` → `/prod:spec` → `/prod:enrich` → `/prod:refine` → `/prod:review` | Idea → research → spec → refined spec → gap analysis |
| **Engineering** | `/think` → `/work` → `/fix` → `/investigate` → `/qa` → `/review` → `/ship` | Spec → code → ship |

## Product Pipeline

Turn an idea into a tight, actionable product spec with tracked unknowns.

### `/prod:research` — Research

Decomposes a question into parallel agent workstreams. Each agent searches the web, writes findings to a markdown file, and a synthesis agent combines them.

```
/prod:research Build an E2E dental claim submission solution on top of our existing platform
```

Produces a `research/` directory with one file per agent plus a synthesis.

### `/prod:spec` — Spec

Takes research output and converts it into a structured product spec. Strips narrative, defines terms, surfaces unknowns as first-class tracked items, questions KPIs.

```
/prod:spec using research/dental-claims focused on submission only
```

Produces a spec file with:
- **Unknowns register** — numbered items (U-01, U-02...) with assumptions, risks, and what blocks on them
- **Requirements** — MUST/SHOULD/COULD with `[depends: U-xx]` tags
- **Business rules** — IF/THEN/ELSE decision logic
- **KPIs** — only what the spec's scope can actually influence

### `/prod:enrich` — Enrich from Codebase

Reads the spec's unknowns, searches the current repo to resolve what it can (schemas, types, configs, integrations), and produces an updated spec version. Fully autonomous — no user input.

```
/prod:enrich research/dental-claims/spec-submission.md
```

Resolves unknowns like "what does our encounter model look like?" by reading the actual schema. Cites every finding with `file:line` references. Anything it can't answer from code stays in the unknowns register for `/prod:refine`.

### `/prod:refine` — Refine with User

Interactive walkthrough of remaining unknowns. Asks one question at a time, in priority order (highest blast radius first). Integrates answers and produces a new versioned spec.

```
/prod:refine research/dental-claims/spec-submission-v2.md
```

Run this as many times as needed. Each pass produces a new version (`v3`, `v4`...) with fewer unknowns. "Skip" or "don't know" is always valid — the unknown stays in the spec.

### `/prod:review` — Gap Analysis

After multiple rounds of enrichment and refinement, audits the spec with fresh eyes. Reads the full version history, checks for consistency issues (orphaned dependency tags, stale assumptions, requirement conflicts), completeness gaps (unaddressed edge cases, missing business rules), and opportunities (existing capabilities that simplify requirements).

```
/prod:review research/dental-claims/spec-submission-v4.md
```

Run this after a few rounds of enrich/refine to catch gaps that accumulate as unknowns get resolved. Produces a new versioned spec with fixes applied and a structured report of what was found.

### The Loop

```
/prod:research  →  /prod:spec  →  /prod:enrich  →  /prod:refine × N  →  /prod:review
   (web)          (structure)     (codebase)        (human)              (audit)
```

Each step reduces ambiguity. Research gathers raw information. Spec structures it and surfaces what's missing. Enrich answers what the code can answer. Refine gets human answers for the rest. Review audits the accumulated changes for gaps and inconsistencies. Loop back to enrich/refine if review surfaces new unknowns.

## Engineering Pipeline

Ship features with structured Claude Code skills. Adapted from [gstack](https://github.com/garrytan/gstack).

Each skill reads the current task from `.aflow/backlog.json` (matched by branch name) and uses its items and acceptance criteria to guide the work.

### `/think` — Plan Before Building

Product strategy session. Forces you to think through what you're building and why. Asks forcing questions (who wants this? what's the smallest version that matters?) and challenges the premise before any code is written.

### `/work` — Implement

Works through the current task's unchecked items. Reads the task, implements each item in dependency order, marks items done as it goes, and typechecks after.

### `/fix` — Fix Issues

Fix bugs or implement changes within the current task scope. Classifies each issue (bug, scope change, new work) and updates the task's items if behavior changes.

### `/investigate` — Debug

Systematic root-cause debugging. Gathers evidence, forms one hypothesis at a time, verifies before fixing. Three-strike rule: if three hypotheses fail, asks for more context.

### `/qa` — Quality Check

QA the current diff against the task's acceptance criteria. Builds a test matrix, walks through each scenario tracing the full code path, and produces a report with PASS/FAIL per criterion.

### `/review` — Code Review

Pre-landing review. Reads every changed file, runs typecheck, checks architecture patterns, security (injection, auth, secrets), and correctness. Auto-fixes critical issues.

### `/ship` — Ship It

End-to-end shipping pipeline: typecheck → review → commit → push → PR. Verifies task items, creates a PR with a summary tied to the task, and updates the task status.

## Worktrees

aflow makes git worktrees practical. Each feature gets its own directory with a shared `.git`.

```bash
af wt create feature-auth          # new branch + worktree, opens a shell
af wt create hotfix --from release  # fork from a specific branch
af wt checkout feature-payments     # worktree from an existing remote branch
af wt list                          # show all worktrees
af wt delete feature-auth           # clean up
af wt cleanup                       # batch-delete merged/stale worktrees
```

Set `AFLOW_DIR` to override where worktrees are stored.

## Hooks

Run setup scripts automatically after creating a worktree:

```bash
af hooks   # creates .aflow/hooks/post_create template
```

The hook receives `WORKTREE_DIR`, `WORKTREE_NAME`, `BASE_BRANCH`, and `REPO_ROOT` as environment variables.

## Auto-Claude [Alpha]

`af start` launches an interactive TUI that runs the engineering pipeline above across a backlog of tasks with parallel Claude Code sessions.

Tasks live in `.aflow/backlog.json`. Add tasks, start them (creates a worktree + Claude session), and monitor multiple sessions running concurrently. Auto-start mode fills available concurrency slots with the highest-priority pending tasks.

![aflow TUI](assets/tui.png)

## License

MIT
