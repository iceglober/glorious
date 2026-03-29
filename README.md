# aflow

AI workflows for product and engineering, powered by Claude Code slash commands.

## Getting Started

```bash
# Install (requires Node.js 20+ and GitHub CLI)
curl -fsSL https://raw.githubusercontent.com/iceglober/aflow/main/install.sh | bash

# Add skills to your repo
af skills
```

### Example: idea to shipping code

```bash
# 1. Research the problem space
/research-web Build a multi-tenant billing system with usage-based pricing

# 2. Create a spec from the research
/spec-make research/billing focused on metering and invoicing

# 3. Enrich the spec from your codebase (autonomous)
/spec-enrich research/billing/spec-metering.md

# 4. Refine unknowns with the user (interactive, repeat as needed)
/spec-refine research/billing/spec-metering-v2.md

# 5. Implement it
/work Add usage metering API per spec R-01 through R-05

# 6. Ship it
/ship
```

## Skills

### Design pipeline

| Step | Skill | What it does |
|------|-------|-------------|
| Research | `/research-web` | Parallel web research agents → synthesis document |
| Structure | `/spec-make` | Research dir or description → structured spec with tracked unknowns |
| Enrich | `/spec-enrich` | Resolves unknowns from your codebase (autonomous) |
| Refine | `/spec-refine` | Walks through unknowns one at a time with the user |
| Audit | `/spec-review` | Gap analysis: consistency, completeness, opportunities |
| Validate | `/spec-lab` | Binary yes/no experiments against unknowns |

```
/research-web  →  /spec-make  →  /spec-enrich  →  /spec-refine × N  →  /spec-review
    (web)        (structure)      (codebase)        (human)              (audit)
                                                                           ↕
                                                                       /spec-lab
                                                                      (validate)
```

`/spec-make` accepts either a research directory or a plain description:

```
/spec-make research/billing focused on metering and invoicing
/spec-make A feature that lets users export data as CSV with column selection
```

### Engineering pipeline

| Step | Skill | What it does |
|------|-------|-------------|
| Plan | `/think` | Strategy session — forces "why" before "how" |
| Build | `/work` | Implement from a description (pulls latest, creates branch) |
| Build | `/work-backlog` | Implement from `.aflow/backlog.json` checklist |
| Fix | `/fix` | Bug fixes within the current task scope |
| Test | `/qa` | Diff vs. acceptance criteria — PASS/FAIL per scenario |
| Ship | `/ship` | Typecheck → review → commit → push → PR |

### Autonomous research

`/research-auto` — think-test-reflect experimentation loop. Runs autonomously until a target metric is hit or you stop it. Based on [ResearcherSkill](https://github.com/krzysztofdudek/ResearcherSkill).

```
/research-auto Optimize p99 latency of /api/billing/usage endpoint
```

## Worktrees

```bash
af wt create feature-auth          # new branch + worktree
af wt checkout feature-payments     # worktree from existing branch
af wt list                          # show all
af wt cleanup                       # delete merged/stale
```

## Auto-Claude [Alpha]

`af start` launches a TUI that runs engineering skills across a task backlog with parallel Claude sessions. Tasks support `dependencies` — blocked tasks won't auto-start until their deps ship.

![aflow TUI](assets/tui.png)

## License

MIT
