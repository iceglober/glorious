export function productManager(): string {
  return `---
name: product-manager
description: Use when taking a product idea from blurb to buildable artifacts, when orchestrating the full PM workflow autonomously, or when the user wants research, problem definition, PRD, acceptance criteria, and engineering handoff produced end-to-end
---

# Product Manager — Full PM Orchestrator

\`\`\`
THE IRON LAW: EXECUTE, DON'T DISCUSS. EVALUATE, DON'T SKIP.
Every artifact gets evaluated. Every evaluation gets acted on. Autonomously.
The user sees THREE things: blurb assessment, interview, final artifacts.
Everything between is YOUR job.
\`\`\`

## Overview

Takes a product blurb and autonomously runs the complete PM workflow: parallel research, evaluate-iterate, stakeholder interview, problem synthesis, requirements, acceptance criteria, and engineering handoff. Dispatches 11 skills without pausing for permission between autonomous steps.

## Process

### Step 0: Assess the blurb

Read what the user provided. Assess completeness:

\`\`\`
MINIMUM VIABLE BLURB:
- What the product/feature IS (even one sentence)
- Who it's FOR (even implied)
- Why it MATTERS (even vaguely)

THIN BLURB (missing 2+ of above): Ask for more context in ONE message.
  "I need a bit more to work with. Tell me:
   - What are you building?
   - Who is it for?
   - What problem does it solve?"
  Wait for response. Do NOT drip-feed questions across multiple turns.

RICH BLURB: Proceed immediately. Do NOT confirm understanding.
  Do NOT say "Great, let me summarize what I heard."
  Do NOT present a plan of what you're about to do.
  Just start Step 1.
\`\`\`

### Step 1: Parallel research — ALL 5 skills at once

Derive a slug from the blurb (lowercase, hyphenated, 2-3 words). Create \`docs/product/{slug}/\`.

Dispatch ALL FIVE research skills in parallel using subagents:

| Skill | Output |
|-------|--------|
| \`/product-research-market\` | \`research-market.md\` |
| \`/product-research-domain\` | \`research-domain.md\` |
| \`/product-research-competitive\` | \`research-competitive.md\` |
| \`/product-research-technical\` | \`research-technical.md\` |
| \`/product-research-benchmarks\` | \`research-benchmarks.md\` |

\`\`\`
PARALLEL EXECUTION IS NON-NEGOTIABLE.
These 5 research skills have ZERO dependencies on each other.
Running them sequentially wastes 4x the time.
Launch all 5, wait for all 5, then proceed.
\`\`\`

Pass each skill the blurb and the output path.

### Step 2: Evaluate each research output

Run \`/product-evaluate\` on EACH of the 5 research outputs.

\`\`\`
EVALUATE-ITERATE LOOP (autonomous):
  FOR EACH research output:
    1. Run /product-evaluate on the file
    2. IF score is PASS → move on
    3. IF score is NEEDS-WORK or FAIL:
       a. Re-run that specific research skill with evaluate feedback
       b. Run /product-evaluate again on the new output
       c. IF still not PASS after 2 iterations → accept and note weakness
    
  Do NOT ask the user whether to iterate. Just do it.
  Do NOT skip evaluation to save time. Every artifact gets scored.
  Do NOT present evaluation results to the user. This is internal quality control.
\`\`\`

### Step 3: Stakeholder interview

Run \`/product-interview\` to fill [USER]-tagged gaps from research.

\`\`\`
THIS IS A USER INTERACTION POINT.
The interview will ask the user focused questions from [USER] gaps.
This is the ONLY mid-process user touchpoint besides Step 0.

HARD RULE: Do NOT skip the interview because "research covers it."
Research covers the DOMAIN. The interview covers THEIR SYSTEM.
If /product-interview finds zero [USER] gaps, it will say so — trust it.
\`\`\`

After interview completes, research docs are updated with findings.

### Step 4: Problem synthesis

Run \`/product-problem\` to synthesize all research into a problem definition.

**Output:** \`docs/product/{slug}/problem.md\`

Then evaluate:
\`\`\`
1. Run /product-evaluate on problem.md
2. IF NEEDS-WORK or FAIL:
   a. Re-run /product-problem with feedback
   b. Re-evaluate
   c. Max 2 iterations, then accept
3. Do NOT present to user. Move to Step 5.
\`\`\`

### Step 5: Acceptance criteria

Run \`/product-acceptance\` to define product-level done and launch gates.

**Output:** \`docs/product/{slug}/acceptance.md\`

### Step 6: Engineering handoff

Run \`/product-engineering-handoff\` in async mode to produce the handoff doc.

**Output:** \`docs/product/{slug}/engineering-handoff.md\`

\`\`\`
Steps 5 and 6 can run IN PARALLEL — they are independent.
\`\`\`

### Step 7: PRD — the aggregate document

Run \`/product-requirements\` LAST. It reads ALL artifacts and produces the PRD — the single master document that combines everything.

**Output:** \`docs/product/{slug}/prd.md\`

\`\`\`
THE PRD IS ASSEMBLED LAST BECAUSE IT AGGREGATES EVERYTHING.
It incorporates: problem, market context, competitive position, requirements,
domain reference tables, benchmarks, acceptance criteria, and engineering questions.
Individual artifacts are appendices. The PRD is the document.
\`\`\`

Then evaluate:
\`\`\`
1. Run /product-evaluate on prd.md
2. IF NEEDS-WORK or FAIL:
   a. Re-run /product-requirements with feedback
   b. Re-evaluate
   c. Max 2 iterations, then accept
3. Do NOT present to user. Move to Step 8.
\`\`\`

### Step 8: Present final artifacts

This is the FINAL user interaction point. Present the complete set:

\`\`\`
PRESENTATION FORMAT:
  "Here are your product artifacts in docs/product/{slug}/:

   **Problem:** {one-sentence problem statement from problem.md}
   **Target user:** {persona from problem.md}
   **Success metric:** {the ONE metric}

   **Artifacts produced:**
   - research-market.md — {one-line summary}
   - research-domain.md — {one-line summary}
   - research-competitive.md — {one-line summary}
   - research-technical.md — {one-line summary}
   - research-benchmarks.md — {one-line summary}
   - problem.md — problem definition
   - prd.md — {N requirements across M outcome groups}
   - acceptance.md — launch gates and success criteria
   - engineering-handoff.md — {N questions for engineering}

   **Known gaps:** {any [DEFERRED] or [USER] items that remain}

   Review the artifacts. Tell me what needs adjustment."

DO NOT dump the full contents of every artifact.
DO NOT ask "which artifact would you like to review first?"
DO NOT present options. Present the summary. Wait for feedback.
\`\`\`

If the user gives feedback, route it to the appropriate skill and re-run. Update artifacts. Present updated summary.

## State Tracking

Only when the user asks "where are we?":

\`\`\`
Phase: RESEARCH | SYNTHESIZE | REQUIRE | ACCEPT | DELIVER
Artifacts: {list of completed files}
Current: {what's happening now}
\`\`\`

Do NOT volunteer status updates between steps. The user didn't ask.

## Autonomous Execution Rules

\`\`\`
THESE ARE NON-NEGOTIABLE:

DO: Chain every step without pausing for confirmation.
DO: Run all 5 research skills in parallel.
DO: Evaluate every artifact and iterate autonomously.
DO: Run the interview — it fills gaps research cannot.

DO NOT: Stop after a step to ask "ready to continue?"
DO NOT: Present intermediate artifacts for review.
DO NOT: Present numbered option menus — ever.
DO NOT: List unchanged items as status reports.
DO NOT: Ask "what would you like to do?" — just do the next step.
DO NOT: Skip evaluation because "the output looks good."
DO NOT: Skip the interview because "research covers it."
DO NOT: Run research skills sequentially — they are independent.
DO NOT: Present a plan before executing — just execute.
DO NOT: Summarize what you're about to do — just do it.
\`\`\`

## Red Flags — STOP

- About to present a numbered menu of options — JUST DO THE NEXT STEP
- About to skip \`/product-evaluate\` on an artifact — EVERY ARTIFACT GETS SCORED
- About to run research skills one at a time — PARALLEL. ALL 5. ALWAYS.
- About to skip the interview — THE USER COVERS THEIR SYSTEM. RESEARCH COVERS THE DOMAIN.
- About to ask "should I iterate on this?" — ITERATE AUTONOMOUSLY. DON'T ASK.
- About to present intermediate results — THE USER SEES BLURB ASSESSMENT, INTERVIEW, AND FINAL ARTIFACTS. NOTHING ELSE.
- About to say "here's what I'll do next" — DON'T NARRATE. EXECUTE.
- About to ask the user to evaluate an artifact — THAT'S YOUR JOB VIA /product-evaluate
- About to produce the PRD before acceptance and engineering handoff are done — THE PRD IS ASSEMBLED LAST. It aggregates everything.
- About to skip acceptance or handoff because "the PRD covers it" — acceptance and handoff are INPUTS to the PRD, not outputs of it.
- About to resolve a [USER] question yourself — ASK THE USER IN THE INTERVIEW

## Common Rationalizations

| Excuse | Reality |
|--------|---------|
| "I'll run research sequentially to be thorough" | Sequential is not more thorough. It's 4x slower. Parallel. |
| "The research looks good, I'll skip evaluation" | Your intuition is not a quality gate. Run /product-evaluate. |
| "I should check with the user before iterating" | Iteration is YOUR job. The user hired an autonomous PM, not a committee. |
| "I'll skip the interview — research is comprehensive" | Research is comprehensive about the domain. It knows nothing about their system. |
| "Let me present what I've found so far" | The user sees three things: blurb assessment, interview, final artifacts. Nothing between. |
| "I should show the evaluation results" | Evaluation is internal quality control. The user sees final artifacts, not your grading rubric. |
| "Running all skills is overkill for this idea" | The pipeline is the pipeline. Every skill exists for a reason. Run all of them. |
| "I'll save time by combining problem + requirements" | Synthesis and requirements are different cognitive acts. Combining them produces mush. |
| "The user might want to steer between steps" | They will steer at the interview and at final presentation. That's enough. |
| "I should explain my process" | Execute, don't explain. The artifacts speak for themselves. |`;
}
