# Rationalization Table & Red Flags

## Rationalization Table

| Excuse | Reality |
|--------|---------|
| "These are too simple for a full plan" | The user invoked /deep-plan, not /fix. Simple tasks get simple plans. They do NOT get skipped. |
| "The user probably wants them fixed, not planned" | You do not read minds. You read commands. The command was /deep-plan. |
| "Rather than a full deep-plan, let me just apply them directly" | This is the #1 failure mode. You are a planner. You do not apply anything. Ever. |
| "The review already identified the changes — planning is redundant" | A review finding is not a plan. A plan has sequenced steps, test cases, dependencies, and tracked tasks. |
| "Auto mode means just do it efficiently" | Auto mode means don't ask for permission at each tool call. It does NOT mean ignore the skill you were invoked to execute. |
| "The spirit of the request is to get fixes done" | The letter of the request is /deep-plan. Follow it. If the user wanted /fix, they would type /fix. |
| "I'll enter plan mode briefly just to think" | Plan mode restricts tool access. Write your thinking as text. EnterPlanMode is forbidden. |
| "This is a critical security fix — surely that's an exception" | No exceptions. Flag it as CRITICAL in the plan. Recommend /fix. Continue planning. You are never the last line of defense. |
| "It's just one line of code" | Scope does not determine whether a rule applies. One forbidden Edit call is the same violation as a hundred. |
| "I know this codebase well enough" | You don't. Read the files. Every time. |
| "The test cases are obvious" | Write the table anyway. Obvious to you != obvious to the executor. |
| "This step is too simple for TDD" | Simple steps break. 5 test rows takes 60 seconds to write. |
| "One layer of tests is enough" | It isn't. Unit tests miss integration bugs. Integration tests miss contract bugs. Defense in depth means every applicable layer. |
| "Negative tests are overkill here" | The bugs you ship are the ones you didn't test for. Adversarial inputs are how real systems break. |
| "I'll figure out the exact path later" | No. Figure it out now. That's what zero ambiguity means. |
| "The user wants this fast" | A wrong plan is slower than a precise one. Read first. |
| "I can invent a reasonable signature" | Reasonable != correct. Derive from existing code. |
| "I'll sync to gs-agentic later" | No. The task tree is created immediately in Step 7. No plan without tracked tasks. |

## Red Flags — STOP if you catch yourself doing any of these

**Implementation violations (Constraint #2):**
- About to call Edit, Write, or NotebookEdit — STOP. You are a planner.
- Saying "let me just fix/apply/implement this" — STOP. Produce a plan.
- Thinking "this is too simple for a plan" — STOP. Simple tasks get simple plans.
- Writing actual code outside of signature examples in the plan — STOP.
- Offering to "just do it" instead of planning — STOP.

**Plan mode violations (Constraint #1):**
- About to call EnterPlanMode — STOP. Write your thinking as text.
- Thinking "I need to think about this in plan mode first" — STOP. Think in your response text.

**Quality violations:**
- Writing a file path you haven't confirmed exists (or confirmed doesn't exist)
- Using a function name you haven't seen in the codebase
- Writing "TBD", "TODO", "figure out", or any hedge word in the plan
- Producing a test case with no concrete input/output values
- Skipping the file change table
- Not saving the plan to the global store via `gs-agentic state plan set --stdin`
- A step has tests at only one layer with no justification for why other layers don't apply
- A step has fewer than 5 test case rows
- No negative/adversarial tests in a step that touches input validation, data access, or endpoints
- Skipping Step 7c/7d — every plan MUST have gs-agentic tasks under an epic
