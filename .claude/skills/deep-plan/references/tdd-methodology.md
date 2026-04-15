# Defense-in-Depth TDD

Every step follows **Red -> Green -> Refactor**, and every feature is tested at multiple layers. A single test at one layer is not enough — bugs slip through layer boundaries.

## Red -> Green -> Refactor (per step)

1. **Red:** Write the test. Run it. Watch it fail. If it passes, the test is wrong — delete and rewrite.
2. **Green:** Write the minimum code to make the test pass. Nothing more.
3. **Refactor:** Clean up while tests stay green. This is a separate commit.

## Test Layers — Every Plan Step Must Specify Which Layers Apply

For each step, explicitly assign tests to one or more of these layers:

| Layer | What it proves | Example |
|-------|---------------|---------|
| **Unit** | Pure logic works in isolation. No DB, no network, no side effects. Mock collaborators. | `calculateRetryDelay(3) === 8000` |
| **Integration** | Components work together through real infrastructure (DB, queues, external services via test doubles). | Insert row → query returns it with correct joins |
| **Contract/API** | HTTP endpoints accept correct input and return correct output shapes. Tests hit the running server. | `POST /v1/webhooks` returns 201 with `{ id, url, active }` |
| **Behavioral/E2E** | Full user-visible workflow produces the right outcome end-to-end. | Create subscription → trigger event → delivery record exists with status `success` |

**Layer assignment rules:**
- Every step with pure logic (transforms, calculations, validation) MUST have **Unit** tests
- Every step that touches the database MUST have **Integration** tests
- Every step that adds/modifies an HTTP endpoint MUST have **Contract/API** tests
- The final step of each feature group MUST have at least one **Behavioral/E2E** test covering the full flow
- A step may (and often should) have tests at multiple layers

## Test Case Table Format

Each test case row must include its layer:

| Layer | Test | Input | Expected |
|-------|------|-------|----------|
| Unit | descriptive name | concrete value | concrete assertion |
| Integration | edge case name | boundary value | concrete assertion |
| Contract | error case name | invalid HTTP payload | 422 with `{ error: "..." }` |
| Behavioral | full flow name | end-to-end scenario setup | end-to-end assertion |

## Negative and Adversarial Tests

Every step MUST include at least one test from each applicable category:

- **Invalid input:** malformed data, wrong types, missing required fields
- **Boundary conditions:** empty arrays, zero values, max-length strings, off-by-one
- **Authorization/access control:** wrong user, wrong org, missing permissions (if the step touches an endpoint or data access layer)
- **Failure propagation:** when a dependency fails (DB down, external service errors), the error surfaces correctly — no silent swallowing, no misleading error messages

If a category doesn't apply to the step, explicitly note why in the plan (e.g., "No auth tests — this is a pure utility function with no access control").

## Per-step enforcement
- Test file is listed BEFORE source file in each step
- Test cases table has minimum 5 rows: happy path, edge case, error case, + at least 2 from the negative/adversarial categories above
- Layer column is filled for every test case row
- "Run `<build/test command from CLAUDE.md>` — all green" appears after each step
- If a step only has tests at one layer, justify why other layers don't apply
