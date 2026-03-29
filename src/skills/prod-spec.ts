export function prodSpec(): string {
  return `---
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
}
