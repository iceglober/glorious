/**
 * Embedded skill files for the aflow workflow.
 * These get written to .claude/commands/ by `af skills`.
 *
 * Each skill operates within the context of an aflow task:
 * - .aflow/backlog.json is the source of truth (tasks, items, acceptance criteria)
 * - The current task is identified by matching `git branch --show-current` to a task's `branch` field
 * - .aflow/spec.md is auto-generated from the backlog — read-only context
 * - CLAUDE.md has project-specific commands (typecheck, build, etc.)
 */

const TASK_PREAMBLE = `## Context: Current task

Run \\\`git branch --show-current\\\` to get the current branch name.

Read \\\`.aflow/backlog.json\\\` and find the task whose \\\`branch\\\` field matches the current branch. This is your **current task**.

If no task matches, tell the user: "This branch isn't linked to an aflow task. Run \\\`af start\\\` to create one."

The task object has:
- \\\`id\\\` — task identifier (e.g. "t3")
- \\\`title\\\` — short description
- \\\`description\\\` — full context
- \\\`items\\\` — checklist of implementation tasks (\\\`{ text, done }\\\`)
- \\\`acceptance\\\` — acceptance criteria (strings)
- \\\`status\\\` — pending | active | shipped | merged
- \\\`branch\\\` — the git branch for this task
- \\\`pr\\\` — PR URL if shipped

Also read \\\`.aflow/spec.md\\\` for a formatted overview of the full backlog, and \\\`CLAUDE.md\\\` for project-specific commands (typecheck, build, lint, etc.).`;

// --- Product skills ---

const PROD_RESEARCH = `---
description: Multi-agent research orchestrator. Decomposes a research question into parallel agent workstreams, launches them, monitors progress, and synthesizes results. Provide the research topic and context.
---

# /prod:research — Multi-Agent Research Orchestrator

Decompose a research question into parallel agent workstreams, launch them, monitor progress, and synthesize results.

---

## Phase 1: Plan the Research

When the user asks to research something:

1. **Understand the question.** What exactly are we trying to learn? Who is it for? What decisions will it inform?

2. **Decompose into agent workstreams.** Each agent should have:
   - A clear, non-overlapping scope (e.g., "Market sizing & competitive landscape", "Technical feasibility & architecture", "Regulatory & compliance landscape")
   - 3-6 specific sections they must write
   - A target output length (~500-1500 lines of markdown per agent is the sweet spot)

3. **Plan the synthesis agent.** This runs AFTER all research agents complete. Its job is to read all agent outputs and produce a single coherent synthesis document with cross-cutting insights, contradictions, and recommendations.

4. **Present the plan to the user.** Format:

\\\`\\\`\\\`
## Research Plan: [Topic]

### Agent 1: [Name]
**Scope:** [1-2 sentence scope]
**Sections:**
1. [Section name]
2. [Section name]
3. ...
**Output file:** research/[topic]/[agent-name].md

### Agent 2: [Name]
...

### Synthesis Agent
**Runs after:** All research agents complete
**Output file:** research/[topic]/synthesis.md
\\\`\\\`\\\`

5. **Wait for user approval** before proceeding. Do NOT launch agents until the user confirms the plan.

---

## Phase 2: Create Skeleton Files

Once the user approves the plan:

1. **Create the output directory:** \\\`research/[topic]/\\\`

2. **For each research agent, create a skeleton markdown file** at the planned path. The skeleton MUST include:
   - Title, Status: IN PROGRESS, Last updated timestamp
   - Critical instructions block telling the agent to follow Search -> Edit -> Search -> Edit pattern
   - Numbered section headings with placeholder text

3. **Also create the synthesis skeleton** with similar critical instructions, but noting it should read from the other agent output files.

---

## Phase 3: Launch Research Agents

Launch ALL research agents in parallel using the Agent tool with \\\`run_in_background: true\\\`.

Each agent prompt MUST include:

1. **The research question and their specific scope** -- be precise about boundaries
2. **The exact file path they must write to** -- absolute path
3. **The section list they must complete** -- numbered, in order
4. **The critical write protocol** -- the agent MUST Edit its output file after EVERY SINGLE search or web fetch. Never two searches in a row without a write. Work through sections in order. Every number needs an inline source URL.
5. **Any relevant context files they should read first** -- provide absolute paths

**IMPORTANT:** Use \\\`run_in_background: true\\\` for all research agents so they run in parallel.

---

## Phase 4: Monitor Progress

Use escalating check-in intervals:

- **~30 seconds:** Verify agents have started writing
- **~2 minutes:** Check approximate progress (line counts, sections done)
- **~5 minutes:** Check for completion. **STUCK AGENT RULE:** If an agent's line count hasn't increased between two consecutive check-ins, stop it immediately and relaunch with pre-loaded data from its search results.
- **Every 5 minutes thereafter** until all agents complete.

Use \\\`wc -l\\\` via Bash for quick line count checks. Keep reports concise.

### Stuck Agent Recovery

1. Stop the agent immediately
2. Read the output file to see what sections are complete
3. Check the agent's process output for useful data it found but never wrote
4. Relaunch with a new agent that skips completed sections and has pre-loaded data

---

## Phase 5: Synthesis

Once ALL research agents are complete:

1. Launch the synthesis agent
2. It MUST read all research agent outputs, identify cross-cutting themes, contradictions, and gaps
3. Produce: executive summary, key findings by theme, contradictions, confidence assessment, recommended next steps
4. Follow the same write protocol (write after every read)

---

## Key Rules

1. **Never launch agents without user approval of the plan.**
2. **Every agent gets the critical write protocol.** Non-negotiable.
3. **Monitor proactively.** Don't wait for the user to ask.
4. **Kill stuck agents immediately.** They do NOT self-correct.
5. **Keep check-in reports concise.**
6. **Source integrity.** Every number needs an inline URL.
7. **Pre-load data on relaunch.** Don't re-research the same ground.
`;

const PROD_SPEC = `---
description: Convert research output into a tight, actionable product spec. Strips narrative, defines terms, surfaces unknowns, questions KPIs. Provide the research directory path and scoping guidance.
---

# /prod:spec — Research to Product Spec

Take research output and convert it into a tight, actionable product spec. Strip narrative, define terms, surface unknowns, question KPIs.

Pipeline: \\\`/prod:research\\\` -> \\\`/prod:spec\\\` -> \\\`/prod:refine\\\` x N

---

## Input

The user provides:
1. **A research directory** to refine (e.g., \\\`research/dental-claims\\\`)
2. **Scoping guidance** — what's in scope, what's explicitly out of scope, what to focus on

Parse the arguments from \\\`$ARGUMENTS\\\` to extract the research path and the scoping constraints.

---

## Phase 1: Ingest and Scope

1. **Read every file in the research directory.** Start with the synthesis, then read each agent output for depth.
2. **Apply the user's scoping constraints.** Out-of-scope items go to an "Out of Scope" section — not deleted, just fenced.
3. **Build a mental model of what THIS spec covers.** Write it down in one sentence.

---

## Phase 2: Identify Unknowns

This is the most important phase. Research agents make assumptions. Your job is to find them.

**Types of unknowns:**
- **Platform Unknowns** — data model, API capabilities, integration points, infrastructure
- **Domain Unknowns** — payer-specific behaviors, edge cases, regional variations
- **Business Unknowns** — build vs. buy, prioritization, pricing, go-to-market
- **Integration Unknowns** — vendor API capabilities, enrollment timelines, PMS constraints

**Format unknowns as open questions:**

\\\`\\\`\\\`
UNKNOWN [U-01]: Current encounter data model schema
  Assumed: Patient demographics, subscriber info exist
  Risk if wrong: Deeper refactoring than estimated
  Needed from: Engineering team — export current schema
  Blocks: Data model design, effort estimates
\\\`\\\`\\\`

Number every unknown (U-01, U-02, ...) so they can be referenced and tracked.

---

## Phase 3: Write the Spec

Write to: \\\`[research-dir]/spec-[scope-slug].md\\\`

### Structure:

1. **Header** — Status, Scope (one sentence), Out of scope, Date, Source research
2. **Unknowns Register** — All unknowns with assumed/risk/needed-from/blocks fields
3. **Definitions** — Every domain term defined precisely. No ambiguity.
4. **Requirements** — ID'd (R-01...), MUST/SHOULD/COULD, references unknowns with \\\`[depends: U-xx]\\\`
5. **Data Requirements** — What data, where from, what's missing
6. **Business Rules** — IF/THEN/ELSE with IDs (BR-01...), flag unknown dependencies
7. **KPIs and Targets** — Only what this scope can influence. Definition, target, confidence, measurement.
8. **Out of Scope** — Fenced with boundary context
9. **Open Questions** — Decisions to make (not facts to find). Options, dependencies, who decides.

---

## Phase 4: Refinement Passes

1. **Fat Trimming** — Remove anything that isn't a requirement, rule, unknown, or decision
2. **First Principles** — For every "must," ask "what breaks if we don't?" If nothing, it's a "should"
3. **Ambiguity Check** — Kill weasel words: "generally," "typically," "usually," "often," "may," "might." Convert to specific rules, unknowns, or delete.
4. **Unknown Cross-Reference** — Every requirement depending on an unknown gets \\\`[depends: U-xx]\\\`

---

## Key Principles

1. **Unknowns are first-class citizens.** Top of the spec, not footnotes.
2. **Requirements, not solutions.** WHAT not HOW.
3. **No narrative.** Specs are reference documents, not stories.
4. **Define everything.** If a term could mean two things, define it.
5. **KPIs earn their place.** Measurable, actionable, attributable to this scope.
6. **Scope is a weapon.** Enforce it aggressively.
7. **Assumptions are risks.** Surface them, don't hide them.
`;

const PROD_REFINE = `---
description: Interactive spec refinement. Walk through unknowns with the user, integrate answers, produce an updated spec with fewer unknowns. Provide the spec file path.
---

# /prod:refine — Interactive Spec Refinement

Walk through a product spec's unknowns with the user, integrate answers, and produce an updated spec with fewer unknowns.

Pipeline: \\\`/prod:research\\\` -> \\\`/prod:spec\\\` -> \\\`/prod:refine\\\` x N

---

## Input

The user provides a path to an existing spec file produced by \\\`/prod:spec\\\`.

Example: \\\`/prod:refine research/dental-claims/spec-submission.md\\\`

Parse the spec path from \\\`$ARGUMENTS\\\`.

---

## Phase 1: Load and Assess

1. **Read the spec file.** Parse all UNKNOWN [U-xx] entries, [depends: U-xx] references, and OQ-xx Open Questions.
2. **Build a dependency map.** For each unknown: which requirements, business rules, KPIs, and open questions depend on it.
3. **Prioritize by blast radius.** Sort by number of downstream dependencies.
4. **Present the assessment** — total unknowns, open questions, blocked requirements, and the priority list with plain-language questions.

---

## Phase 2: Interactive Resolution

Walk through unknowns ONE AT A TIME, in priority order.

For each unknown:

1. **Ask a clear, answerable question.** Translate the unknown into plain language.
   - Bad: "What is the current encounter data model schema?"
   - Good: "Does your encounter model store procedure codes? If so, are they CPT codes, CDT codes, or a generic code field?"

2. **Wait for the user's response.** They may:
   - Answer fully -> mark RESOLVED
   - Answer partially -> narrow the remaining gap
   - Say "skip" or "don't know" -> leave as-is, move on
   - Provide info that changes the spec -> note the change
   - Ask a clarifying question back -> answer it, then re-ask

3. **After each answer, briefly state the impact** and immediately move to the next question.

4. **If an answer creates NEW unknowns**, note them.

5. **If an answer changes a requirement or rule**, note the change. Don't rewrite mid-conversation.

---

## Phase 3: Open Questions

After unknowns, present each Open Question as a decision:

"**OQ-03: Real-time or batched submission?**
Options: (A) always real-time, (B) always batch, (C) configurable.
Given what we've learned, [option X] seems most aligned. Preference?"

If decided -> convert to business rule or requirement.
If deferred -> leave as OQ.

---

## Phase 4: Generate Updated Spec

Once the user has answered what they can:

1. **Read the current spec in full.**
2. **Apply all changes:**
   - Resolved unknowns -> remove from register, embed facts in requirements, remove [depends: U-xx] tags
   - Partially resolved -> update the unknown, keep tags
   - New unknowns -> add to register with next U-number
   - Resolved OQs -> convert to BR-xx or R-xx
   - Changed requirements -> update text and MUST/SHOULD/COULD level

3. **Write to a NEW file:** \\\`[original-name]-v[N].md\\\`. NEVER overwrite the previous version.

4. **Add a changelog** at the top:
   - What was resolved, partially resolved, newly discovered
   - Which OQs were decided
   - Which requirements changed
   - Remaining unknowns and open questions count

5. **Present a summary:** resolved count, remaining count, key changes, next steps, file path.

---

## Rules

1. **One question at a time.** Don't dump all unknowns at once.
2. **Translate, don't copy.** Plain language for the person in front of you.
3. **"Skip" is always valid.** Never pressure.
4. **Facts become requirements. Decisions become rules.**
5. **Never lose information.** Resolved unknowns become embedded facts.
6. **Version, don't overwrite.** Every pass produces a new file.
7. **New unknowns are progress.** More specific = more concrete.
8. **Stay in scope.** Don't pull out-of-scope items back in.
9. **Keep the pace.** Ask the next question immediately after stating impact.
`;

const PROD_ENRICH = `---
description: Autonomous spec enrichment from codebase. Reads a product spec, researches the current repo to resolve unknowns, and produces an updated spec version — no user input needed. Provide the spec file path.
---

# /prod:enrich — Codebase-Driven Spec Enrichment

Read a product spec, research the current codebase to resolve unknowns, and produce an updated spec version autonomously — no user input required.

Pipeline: \\\`/prod:research\\\` -> \\\`/prod:spec\\\` -> \\\`/prod:enrich\\\` -> \\\`/prod:refine\\\` x N

Unlike \\\`/prod:refine\\\` (interactive, user answers questions), this skill is fully autonomous. It reads the repo to answer what the repo can answer, then hands off to the user for what it can't.

---

## Input

The user provides a path to an existing spec file.

Example: \\\`/prod:enrich research/dental-claims/spec-submission.md\\\`

Parse the spec path from \\\`$ARGUMENTS\\\`.

---

## Phase 1: Load Spec and Identify Researchable Unknowns

1. **Read the spec file in full.** Parse all UNKNOWN [U-xx] entries and their "Needed from" fields.

2. **Classify each unknown by researchability:**

   **Researchable from codebase** — the answer is in the repo:
   - Data model questions -> read schema files, migrations, models, types
   - API capabilities -> read route handlers, service files, SDK usage
   - Integration details -> read config, client libraries, API calls
   - Current workflow/lifecycle -> read state machines, event handlers, job runners
   - Provider/payer data -> read seed files, config tables, enums

   **Researchable from dependencies** — the answer is in installed packages or their docs:
   - SDK capabilities -> read node_modules types, package docs
   - Validation behavior -> read library source or config

   **NOT researchable** — requires human input:
   - Business decisions (pricing, prioritization, GTM)
   - Domain expertise (payer-specific rules, billing practices)
   - External vendor capabilities (requires contacting vendor)
   - Legal/compliance questions

3. **Plan the research.** For each researchable unknown, identify:
   - What to search for (file patterns, keywords, types)
   - Where to look (directories, specific files)
   - What would constitute a resolution vs. a partial answer

4. **Present the plan to the user:**

\\\`\\\`\\\`
## Enrichment Plan: [spec name]

**Total unknowns:** N
**Researchable from codebase:** N
**Researchable from dependencies:** N
**Requires human input (skipping):** N

### Will research:
1. [U-xx]: [title] — searching [what/where]
2. [U-xx]: [title] — searching [what/where]
...

### Skipping (not in codebase):
- [U-xx]: [title] — needs [who/what]
...

Proceeding with research.
\\\`\\\`\\\`

Do NOT wait for approval — proceed immediately after presenting the plan. This skill is meant to be autonomous.

---

## Phase 2: Research

Launch parallel research agents for independent unknowns. Use sequential research for unknowns that depend on each other.

### For each researchable unknown:

1. **Search the codebase** using Glob and Grep:
   - Schema/model files: \\\`**/*.prisma\\\`, \\\`**/models/**\\\`, \\\`**/schema.*\\\`, \\\`**/migrations/**\\\`, \\\`**/*.entity.*\\\`
   - Type definitions: \\\`**/*.d.ts\\\`, \\\`**/types/**\\\`, \\\`**/interfaces/**\\\`
   - API routes: \\\`**/routes/**\\\`, \\\`**/api/**\\\`, \\\`**/controllers/**\\\`
   - Config: \\\`**/*.config.*\\\`, \\\`**/.env.example\\\`, \\\`**/config/**\\\`
   - Services/integrations: \\\`**/services/**\\\`, \\\`**/integrations/**\\\`, \\\`**/clients/**\\\`
   - Search for keywords from the unknown (e.g., "encounter", "procedure", "npi", "stedi", "payer")

2. **Read relevant files** to understand the actual implementation.

3. **Record findings** with specific file:line references. Be precise:
   - "Found \\\`encounter\\\` table in \\\`prisma/schema.prisma:42\\\` with fields: patientId, providerId, dateOfService, status. No procedure-level fields."
   - NOT "The encounter model appears to have some fields."

4. **Classify the result:**
   - **RESOLVED** — found a definitive answer. Record the fact.
   - **PARTIALLY RESOLVED** — found relevant info that narrows the unknown. Record what's known and what remains.
   - **UNRESOLVABLE FROM CODE** — searched thoroughly, answer is not in the codebase. Reclassify as requires-human.

### Research strategies by unknown type:

**Data model unknowns:**
- Search for ORM models, schema files, migration files, database types
- Look for entity definitions, interfaces, and type aliases
- Check seed files for reference data (payer lists, code tables, etc.)

**Integration unknowns:**
- Search for SDK imports and client instantiation
- Read API call sites to understand what endpoints are used
- Check config/env for API keys, endpoints, feature flags

**Workflow unknowns:**
- Search for state machines, status enums, event handlers
- Read job/worker files for background processing patterns
- Check webhook handlers for inbound event processing

**Provider/configuration unknowns:**
- Search for provider tables, NPI fields, taxonomy references
- Check onboarding flows, admin UIs, setup scripts

---

## Phase 3: Generate Updated Spec

Apply the same rules as \\\`/prod:refine\\\` Phase 4:

1. **Write to a NEW file:** \\\`[original-name]-v[N].md\\\`. Never overwrite.

2. **For resolved unknowns:**
   - Remove from Unknowns Register
   - Embed the discovered fact in the relevant section with file:line references
   - Remove \\\`[depends: U-xx]\\\` tags from unblocked requirements
   - Update requirements if the discovered reality changes them (e.g., a MUST becomes impossible, or a new constraint is discovered)

3. **For partially resolved unknowns:**
   - Update the "Known" and "Remaining gap" fields
   - Add file:line references for what was found
   - Keep \\\`[depends: U-xx]\\\` tags

4. **For new discoveries** that aren't tied to existing unknowns:
   - If the codebase reveals a constraint or capability the spec didn't account for, add it as a new requirement or update an existing one
   - If the codebase reveals a new unknown (e.g., "the encounter model exists but uses a custom ORM that may not support the needed queries"), add it to the register

5. **Add a changelog** at the top:

\\\`\\\`\\\`markdown
## Changelog

### v[N] — enriched from codebase (YYYY-MM-DD)
- Resolved from code: U-xx ([title] — [one-line finding with file ref])
- Partially resolved: U-xx ([what was found])
- New discoveries: [anything the codebase revealed that wasn't in the spec]
- Still requires human input: U-xx, U-xx, ...
- Remaining unknowns: N
\\\`\\\`\\\`

---

## Phase 4: Report

Present the results:

\\\`\\\`\\\`
## Enrichment Complete

**Researched:** N unknowns
**Resolved from codebase:** N
**Partially resolved:** N
**Not in codebase (needs human):** N
**New discoveries:** N

### Key findings:
- [most impactful facts discovered, with file references]

### Still needs human input:
- [U-xx]: [title] — [why it can't be answered from code]

Updated spec: [file path]
Run \\\`/prod:refine [new file path]\\\` to resolve remaining unknowns with the user.
\\\`\\\`\\\`

---

## Rules

1. **Be thorough but not exhaustive.** Search broadly first (Glob for patterns), then deep-read relevant files. Don't read every file in the repo.
2. **Cite everything.** Every fact from the codebase gets a file:line reference. The user should be able to verify any finding in 10 seconds.
3. **Don't guess.** If the code is ambiguous, record the ambiguity as a partial resolution, not a guess. "Found two possible encounter tables — \\\`encounters\\\` and \\\`clinical_encounters\\\` — unclear which is primary" is better than picking one.
4. **Respect scope.** Only research unknowns that are in the spec. Don't go exploring tangential topics.
5. **Preserve the spec structure.** The output must have the same sections as the input. Don't reorganize — just update content.
6. **Version, don't overwrite.** Always write a new file.
7. **The codebase is truth.** If the code contradicts the spec's assumption, the code wins. Update the spec accordingly and flag the discrepancy.
8. **Proceed without approval.** This skill is autonomous by design. Present the plan and immediately start researching.
`;

const PROD_REVIEW = `---
description: Spec gap analysis after refinement. Reads the latest spec version, reviews all changes from prior versions, and identifies new gaps, inconsistencies, or opportunities revealed by resolved unknowns. Provide the spec file path.
---

# /prod:review — Spec Gap Analysis

Read the latest spec version, review the changelog of what's been resolved, and identify new gaps, inconsistencies, or opportunities that weren't visible before unknowns were resolved.

Pipeline: \\\`/prod:research\\\` -> \\\`/prod:spec\\\` -> \\\`/prod:enrich\\\` -> \\\`/prod:refine\\\` x N -> \\\`/prod:review\\\`

After multiple rounds of enrichment and refinement, a spec accumulates changes. Resolving unknowns can reveal new gaps — requirements that conflict, business rules that don't cover newly understood edge cases, or opportunities enabled by discoveries. This skill audits the spec with fresh eyes.

---

## Input

The user provides a path to the latest version of a spec file.

Example: \\\`/prod:review research/dental-claims/spec-submission-v4.md\\\`

Parse the spec path from \\\`$ARGUMENTS\\\`.

---

## Phase 1: Load and Reconstruct History

1. **Read the spec file in full.** Parse:
   - All sections: header, unknowns register, definitions, requirements, data requirements, business rules, KPIs, out of scope, open questions
   - The changelog — every version's changes

2. **Find prior versions.** Look in the same directory for earlier versions of this spec (\\\`-v1.md\\\`, \\\`-v2.md\\\`, or the unnumbered original). Read the oldest available version to understand the starting point.

3. **Build a change inventory.** From the changelogs and diffs between versions:
   - What unknowns were resolved, and how?
   - What requirements were added, modified, or re-leveled (MUST <-> SHOULD <-> COULD)?
   - What business rules were added or changed?
   - What new unknowns were introduced during refinement?
   - What open questions were decided?

---

## Phase 2: Gap Analysis

Work through each category systematically. For each, identify gaps the spec doesn't currently address.

### A. Consistency Audit

Check that resolved unknowns were fully propagated:

1. **Orphaned dependencies.** Search for \\\`[depends: U-xx]\\\` tags referencing unknowns that no longer exist in the register. These should have been cleaned up when the unknown was resolved.

2. **Stale assumptions.** For each resolved unknown, check whether its resolution invalidates assumptions elsewhere in the spec. Example: U-03 assumed a simple data model, but enrichment revealed a multi-tenant schema — do requirements still make sense?

3. **Definition drift.** Check the Definitions section against how terms are actually used in requirements and rules. Has a term's meaning shifted as unknowns were resolved?

4. **Requirement conflicts.** With unknowns resolved, do any requirements now contradict each other? Requirements that were compatible when vague may conflict when specific.

### B. Completeness Audit

Check whether resolved unknowns reveal work the spec doesn't account for:

1. **Unaddressed edge cases.** Resolved unknowns often reveal edge cases. Example: learning the encounter model supports multi-location practices means the spec needs to address location-scoping. Does it?

2. **Missing business rules.** For each resolved unknown that revealed complexity, check whether the business rules section covers the newly understood scenarios. IF/THEN/ELSE rules should exist for each decision point.

3. **Data requirement gaps.** Resolved data model unknowns may reveal fields, tables, or relationships the spec's data requirements section doesn't mention.

4. **KPI measurability.** With more known about the system, re-evaluate whether KPIs are actually measurable. A KPI that seemed measurable when abstract may not be with the real data model.

### C. Opportunity Scan

Check whether discoveries enable things the spec didn't consider:

1. **Capabilities discovered in enrichment.** Did the codebase reveal existing functionality the spec could leverage? Example: enrichment found an existing notification service — could it simplify a requirement?

2. **Simplification opportunities.** Do resolved unknowns make any requirements simpler than originally scoped? Requirements written around worst-case assumptions may be over-engineered given actual findings.

3. **Scope boundary shifts.** With new information, should anything move in or out of scope? Be cautious here — only flag clear cases, don't expand scope speculatively.

### D. Remaining Unknown Quality

Audit the unknowns that are still open:

1. **Stale unknowns.** Are any remaining unknowns answerable from information elsewhere in the spec? Sometimes resolving U-01 provides enough information to resolve U-12, but no one noticed.

2. **Unknown specificity.** Early unknowns are often broad ("what's the data model?"). After refinement, remaining unknowns should be narrow and specific. Flag any that are still too vague to be actionable.

3. **Missing unknowns.** Given everything that's been learned, are there unknowns that should exist but don't? New knowledge creates new questions.

---

## Phase 3: Generate Updated Spec

1. **Write to a NEW file:** \\\`[original-name]-v[N].md\\\`. Never overwrite.

2. **Apply fixes for each finding:**

   **Consistency fixes:**
   - Remove orphaned \\\`[depends: U-xx]\\\` tags
   - Update requirements whose assumptions were invalidated
   - Correct definitions that drifted
   - Resolve requirement conflicts (flag to user if the resolution isn't clear-cut)

   **Completeness additions:**
   - Add requirements for discovered edge cases
   - Add business rules for new decision points
   - Update data requirements with newly understood fields/relationships
   - Update KPI measurability notes

   **Opportunity notes:**
   - Add a "## Opportunities" section (or update existing) noting capabilities that could simplify implementation
   - Adjust requirement complexity where discoveries enable simpler approaches
   - Flag scope boundary shifts as open questions if not clear-cut

   **Unknown updates:**
   - Resolve unknowns answerable from existing spec information
   - Split vague unknowns into specific sub-unknowns
   - Add newly identified unknowns with proper numbering

3. **Add a changelog entry:**

\\\`\\\`\\\`markdown
### v[N] — spec review (YYYY-MM-DD)
- Consistency: [what was fixed — orphaned tags, stale assumptions, conflicts]
- Completeness: [what was added — edge cases, rules, data requirements]
- Opportunities: [what was identified — simplifications, existing capabilities]
- Unknowns: [resolved N from existing info, split N into sub-unknowns, added N new]
- Remaining unknowns: N
- Remaining open questions: N
\\\`\\\`\\\`

---

## Phase 4: Report

\\\`\\\`\\\`
## Spec Review Complete

**Spec:** [file name]
**Versions reviewed:** [v1 through vN]
**Changes since original:** [summary count — resolved unknowns, new requirements, etc.]

### Consistency
- **Orphaned tags:** N fixed
- **Stale assumptions:** N found, N corrected
- **Requirement conflicts:** N found, N resolved

### Completeness
- **Edge cases added:** N
- **Business rules added:** N
- **Data requirements updated:** N

### Opportunities
- [1-3 most impactful findings]

### Unknowns
- **Resolved from existing info:** N
- **Split into sub-unknowns:** N
- **New unknowns added:** N
- **Remaining:** N unknowns, N open questions

Updated spec: [file path]

**Next step:**
- If new unknowns were added -> run \\\`/prod:enrich [new file]\\\` then \\\`/prod:refine [new file]\\\`
- If spec is clean -> ready for engineering (\\\`/think\\\` -> \\\`/work\\\`)
\\\`\\\`\\\`

---

## Rules

1. **Fresh eyes.** Read the spec as if seeing it for the first time. Don't assume prior versions were correct.
2. **Cite your reasoning.** For every gap identified, explain what resolved unknown or change created it.
3. **Don't expand scope.** Flag opportunities, don't act on them. The user decides what's in scope.
4. **Consistency over completeness.** A consistent spec with known gaps is better than an inconsistent spec that tries to cover everything.
5. **Version, don't overwrite.** Always write a new file.
6. **Respect the pipeline.** This skill audits — it doesn't replace enrichment or refinement. If new unknowns need human input, say so and point to \\\`/prod:refine\\\`.
7. **Be specific.** "Some requirements may conflict" is useless. "R-12 requires real-time submission but R-27 assumes batch processing" is actionable.
8. **Proceed autonomously.** Like \\\`/prod:enrich\\\`, this skill runs without waiting for approval. Present findings and the updated spec.
`;

export const SKILLS: Record<string, string> = {
  "think.md": `---
description: Product strategy session before building. Forces you to think through what you're building and why before writing code. Provide a feature idea or problem to explore.
---

# Think

You are a product strategist helping think through a feature before any code is written. Your job is to prevent building the wrong thing.

## Input

The user describes what they want to build: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Process

### Step 1: Understand the landscape

- Read \`.aflow/spec.md\` for the full backlog — what's pending, active, shipped
- Read \`CLAUDE.md\` to understand the project's architecture
- Skim the relevant source files to understand the current state

### Step 2: Ask forcing questions

Ask these one at a time. Wait for the answer before asking the next. Push back on vague answers.

1. **Who specifically wants this?** Not "users" — a specific person or persona. If you can't name one, stop here.

2. **What are they doing today without it?** There's always a workaround. How painful is it? If the workaround is fine, this can wait.

3. **What's the smallest version that matters?** Not the full vision — the narrowest slice someone would actually use. One screen. One action. One outcome.

4. **What breaks if we build it wrong?** Every feature has a failure mode. Does it corrupt data? Create tech debt? Name the risk.

5. **Does the backlog already cover this?** Check the existing tasks. Is this a new task, a change to an existing one, or already queued?

### Step 3: Challenge the premise

Based on the answers, do ONE of:
- **Validate** — the idea holds up. Move to Step 4.
- **Redirect** — a different approach would solve the same problem better.
- **Defer** — the idea is good but premature. Say when it should happen.
- **Kill** — the idea doesn't serve the product. Explain honestly.

### Step 4: Plan the implementation

If validated, write a concise plan:

\`\`\`markdown
## Feature: {name}

**Problem:** {one sentence}
**Who:** {specific user}
**Smallest version:** {what to build}
**Depends on:** {prerequisites}
**Risk:** {what could go wrong}

### Implementation sketch
1. {schema changes}
2. {API changes}
3. {client changes}
4. {UI changes}

### What this does NOT include
- {explicit scope cuts}
\`\`\`

### Step 5: Update the task

If the current task exists and this planning session refines it:
- Update the task's \`items\` array in \`.aflow/backlog.json\` with the implementation checklist
- Update \`acceptance\` with clear acceptance criteria
- Set the \`design\` field to a brief summary of the plan

If this is a new feature not yet in the backlog, tell the user to add it via \`af start\`.

## Rules

- Never produce code in this skill. Plans and task updates only.
- Push back on vague answers. "All users" is not an answer.
- Be direct. "This isn't worth building" is a valid output.
- Read the backlog before evaluating — don't duplicate existing work.
`,

  "work.md": `---
description: Implement the current task's items. Reads the task from the backlog, works through unchecked items, checks them off as completed. Provide optional focus area.
---

# Work

You are implementing the current aflow task, working through its checklist items.

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

## Rules

- The task's items are your checklist — work through them
- Mark items done one at a time as you complete them, not all at the end
- If you discover work that has no corresponding item, add a new item to the task's \`items\` array and implement it
- Read source files before editing them
- Use existing patterns in the codebase — match the style of adjacent code
- Do not modify other tasks in the backlog
`,

  "fix.md": `---
description: Fix bugs or implement changes for the current task. Updates the task's items if behavior changes. Provide the list of issues to address.
---

# Fix

You are fixing issues or making changes within the scope of the current aflow task.

## Input

The user provides issues to address: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Process

### Step 1: Understand the issues

Read each issue carefully. Classify each as:
- **Bug** — code doesn't match what the task describes (code changes, task stays)
- **Scope change** — the desired behavior differs from the task's items (both change)
- **New work** — something not covered by the task at all (add items, then implement)

### Step 2: Implement the fixes

For each issue:
1. Read the relevant source files before making changes
2. Implement the fix
3. Typecheck after changes (see CLAUDE.md)

### Step 3: Update the task (if needed)

Only update \`.aflow/backlog.json\` if an issue is a **scope change** or **new work**:
- Add new items for new work
- Mark completed items as \`done: true\`
- Update acceptance criteria if behavior changed
- Leave unrelated items alone

### Step 4: Verify

- Typecheck passes
- Each fix addresses the reported issue
- Task items accurately reflect completed work

## Rules

- Implement code changes first, then update the backlog
- Read source files before editing them
- The task's acceptance criteria define what "correct" means
- If a fix contradicts the task's intent, flag it to the user
`,

  "investigate.md": `---
description: Systematic root-cause debugging. Traces a symptom to its cause before fixing anything. Provide the bug description or error message.
---

# Investigate

You are debugging an issue. **No fixes until root cause is confirmed.**

## Input

The user describes a symptom: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Phase 1: Gather evidence

- Read the current task for context on what was recently changed
- Read \`.aflow/spec.md\` to understand the broader project state
- Read the error message or symptom description carefully
- If there's a stack trace, identify the exact file and line
- Check recent git history: \`git log --oneline -10 -- <affected-files>\`
- Read the affected source files in full

**Output:** A clear statement of what's happening, where, and since when.

## Phase 2: Form hypothesis

Based on the evidence, identify the most likely cause. Classify it:

| Pattern | Signs |
|---------|-------|
| Null/undefined propagation | "Cannot read property of undefined" |
| Type mismatch | Works in TS but fails at runtime |
| Race condition | Intermittent, timing-dependent |
| State corruption | Partial updates, stale closures |
| Auth/permissions | 401/403, missing auth checks |
| Configuration | Works locally but not in Docker |
| Import/dependency | Module not found, version mismatch |

**Output:** One specific, testable hypothesis.

## Phase 3: Verify hypothesis

**Do not fix yet.** Verify first:

- Read the code at the suspected location
- Trace the data flow: inputs → transforms → output
- If the code doesn't confirm the hypothesis, **abandon it** and form a new one

**3-strike rule:** If three hypotheses fail, ask the user for more context.

**Output:** "Confirmed: {hypothesis} because {evidence}" or "Rejected: {why}, new hypothesis: {next}"

## Phase 4: Fix

Once root cause is confirmed:

1. Make the minimal fix — fewest files, fewest lines
2. Typecheck (see CLAUDE.md)
3. If the fix completes a task item, mark it done in \`.aflow/backlog.json\`

**Blast radius check:** If the fix touches more than 3 files, explain why and ask before proceeding.

## Phase 5: Report

\`\`\`
## Bug Report

**Symptom:** {what the user saw}
**Root cause:** {what actually went wrong}
**Fix:** {file:line — what changed and why}
**Task items updated:** {yes/no}
**Verified:** {how you confirmed the fix}
\`\`\`

## Rules

- Never fix before confirming root cause.
- Read code before theorizing.
- One hypothesis at a time.
- Minimal diff. Don't refactor while debugging.
- If you can't find it, say so.
`,

  "qa.md": `---
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
`,

  "review.md": `---
description: Pre-landing code review for the current task. Analyzes diff for correctness, security, and architecture. Auto-fixes critical issues. Provide optional context.
---

# Review

You are performing a pre-landing code review. This is the gate before shipping.

## Input

Optional context: \`$ARGUMENTS\`

${TASK_PREAMBLE}

## Process

### Step 1: Scope the diff

\`\`\`bash
git diff main...HEAD --stat
git log main..HEAD --oneline
\`\`\`

Read every changed file in full. Understand the diff as a whole.

### Step 2: Typecheck

Run the project's typecheck command (see CLAUDE.md). If it fails, fix before continuing.

### Step 3: Architecture review

Check against the project's patterns (from CLAUDE.md):
- Are imports following established dependency rules?
- Do new API routes have proper auth?
- Is data access properly scoped?
- Are new env vars added to \`.env.example\`?

### Step 4: Security review

For each changed file:
- **Injection:** Raw SQL with user input? \`dangerouslySetInnerHTML\`? Shell exec with user strings?
- **Auth:** Missing auth checks? Cross-user data access? Secrets in client bundle?
- **Input:** Unvalidated request bodies? Unbounded queries?
- **Secrets:** Hardcoded keys? \`.env\` not gitignored?

### Step 5: Correctness review

For each changed file:
- Logic errors, off-by-one, null/undefined gaps
- Missing error handling at system boundaries
- Race conditions in async code
- Dead code or unused imports
- Inconsistent patterns vs. adjacent code

### Step 6: Completeness audit

Map every code path the diff introduces:
- Happy path, error path, edge cases
- For each: does the code handle it?

### Step 7: Task alignment

Compare the diff against the task's acceptance criteria:
- Does the code satisfy all criteria?
- Does the diff go beyond the task's scope?
- Are there task items the diff should complete but doesn't?

### Step 8: Classify and fix

For each finding:
- **CRITICAL** — Bug, security hole, data loss. Fix immediately.
- **ISSUE** — Real problem, not dangerous. Fix and explain.
- **SUGGESTION** — Could be better, isn't broken. List and ask.

### Step 9: Summary

\`\`\`
## Review Summary

**Task:** {id}: {title}
**Changes:** {one sentence}
**Files:** {count} changed
**Findings:** {N} critical, {N} issues, {N} suggestions
**Fixed:** {what was auto-fixed}
**Verdict:** CLEAN / ISSUES FIXED / NEEDS ATTENTION
\`\`\`

## Rules

- Read every changed file. Do not skim.
- Fix CRITICAL and ISSUE findings immediately.
- Never refactor code outside the diff.
- If the diff is clean, say "Clean" — don't manufacture findings.
`,

  "ship.md": `---
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

Run the \`/review\` process on the current diff.
- **CRITICAL:** Fix. Non-negotiable.
- **ISSUE:** Fix.
- **SUGGESTION:** List. Ask: "Fix or ship as-is?"

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
`,

  // --- Product skills (installed to prod/ subdirectory) ---

  "prod/research.md": PROD_RESEARCH,
  "prod/spec.md": PROD_SPEC,
  "prod/refine.md": PROD_REFINE,
  "prod/enrich.md": PROD_ENRICH,
  "prod/review.md": PROD_REVIEW,
};
