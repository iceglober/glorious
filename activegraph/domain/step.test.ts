import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { err, ok } from "../lib/fp";
import { createKit } from "./behaviors";
import { createMutations } from "./mutations";
import { defineSchema, objectId } from "./schema";
import {
  appendExternal,
  applyProposals,
  type BehaviorOutcome,
  derivedIdStrategy,
  initialState,
  planStep,
  type RuntimeState,
  type StepPlan,
  settleStep,
} from "./step";

const schema = defineSchema({
  objects: {
    task: z.object({ title: z.string(), status: z.enum(["open", "done"]) }),
  },
  relations: { depends_on: { source: "task", target: "task" } },
  events: { "task.completed": z.object({ taskId: z.string() }) },
});
type S1 = typeof schema;
const m = createMutations(schema);
const kit = createKit(schema);
const stamp = { at: "2026-01-01T00:00:00.000Z", elapsedSeconds: 0 };
const ids = derivedIdStrategy;

const seeded = (): RuntimeState<S1> =>
  appendExternal({
    state: initialState<S1>("main"),
    entries: [{ type: "goal.created", payload: { goalId: "g1", text: "go" } }],
    at: stamp.at,
  }).state;

const dispatchOf = (plan: StepPlan<S1>): Extract<StepPlan<S1>, { kind: "dispatch" }> => {
  if (plan.kind !== "dispatch") throw new Error(`expected dispatch, got ${plan.kind}`);
  return plan;
};

describe("appendExternal", () => {
  test("appends null-cause events, applies them, and enqueues them for dispatch", () => {
    const state = seeded();
    expect(state.log.map((e) => e.type)).toEqual(["goal.created"]);
    expect(state.queue).toHaveLength(1);
    expect(state.log[0]?.causedBy).toBeNull();
    expect(state.nextEventId).toBe(2);
    expect(state.status).toBe("running");
  });
});

describe("planStep", () => {
  test("dispatches the queue head, counts it, and pre-appends behavior.scheduled per match", () => {
    const noop = kit.behavior({ name: "noop", on: ["goal.created"], run: () => [] });
    const plan = dispatchOf(planStep({ state: seeded(), behaviors: [noop], budget: {}, stamp }));
    expect(plan.event.type).toBe("goal.created");
    expect(plan.matches.map((b) => b.name)).toEqual(["noop"]);
    expect(plan.scheduled.map((e) => e.type)).toEqual(["behavior.scheduled"]);
    expect(plan.state.processed).toBe(1);
    // The scheduled event is itself dispatchable.
    expect(plan.state.queue.map((e) => e.type)).toEqual(["behavior.scheduled"]);
  });

  test("emits runtime.idle exactly once per drain, then stops", () => {
    let state = seeded();
    // Drain the goal event with no behaviors.
    const plan = dispatchOf(planStep({ state, behaviors: [], budget: {}, stamp }));
    state = settleStep({ schema, plan, outcomes: [], stamp, ids }).state;
    const idlePlan = planStep({ state, behaviors: [], budget: {}, stamp });
    expect(idlePlan.kind).toBe("idle");
    if (idlePlan.kind !== "idle") return;
    expect(idlePlan.idleEvent.type).toBe("runtime.idle");
    state = idlePlan.state;
    // The idle event is dispatchable; a matchless dispatch keeps status idle.
    const idleDispatch = dispatchOf(planStep({ state, behaviors: [], budget: {}, stamp }));
    state = settleStep({ schema, plan: idleDispatch, outcomes: [], stamp, ids }).state;
    expect(planStep({ state, behaviors: [], budget: {}, stamp }).kind).toBe("stop");
  });

  test("budget maxEvents parks the queue with a single runtime.budget_exhausted event", () => {
    let state = appendExternal({
      state: seeded(),
      entries: [{ type: "task.completed", payload: { taskId: "t" } }],
      at: stamp.at,
    }).state;
    const budget = { maxEvents: 1 };
    const first = dispatchOf(planStep({ state, behaviors: [], budget, stamp }));
    state = settleStep({ schema, plan: first, outcomes: [], stamp, ids }).state;
    const exhausted = planStep({ state, behaviors: [], budget, stamp });
    expect(exhausted.kind).toBe("budget_exhausted");
    if (exhausted.kind !== "budget_exhausted") return;
    expect(exhausted.event.payload).toEqual({ limit: "max_events", processed: 1 });
    // Second call does not emit a second marker.
    expect(planStep({ state: exhausted.state, behaviors: [], budget, stamp }).kind).toBe("stop");
    // A looser budget resumes dispatching the parked queue.
    const resumed = planStep({ state: exhausted.state, behaviors: [], budget: {}, stamp });
    expect(resumed.kind).toBe("dispatch");
  });

  test("budget maxSeconds uses the stamp's elapsed clock", () => {
    const state = seeded();
    const late = { at: stamp.at, elapsedSeconds: 61 };
    const plan = planStep({ state, behaviors: [], budget: { maxSeconds: 60 }, stamp: late });
    expect(plan.kind).toBe("budget_exhausted");
  });
});

describe("applyProposals", () => {
  test("addObject appends proposed → applied → object.created with a derived id", () => {
    const { state, appended } = applyProposals({
      schema,
      state: seeded(),
      proposals: [m.addObject("task", { title: "A", status: "open" })],
      actor: "planner",
      causedBy: 1,
      at: stamp.at,
      ids,
    });
    expect(appended.map((e) => e.type)).toEqual([
      "patch.proposed",
      "patch.applied",
      "object.created",
    ]);
    const createdId = "task_4_0"; // domain event id 4, first proposal
    expect(state.graph.objects.get(createdId)).toMatchObject({ type: "task", version: 1 });
    expect(appended[1]?.payload).toMatchObject({ actor: "planner", mutation: { id: createdId } });
  });

  test("a rejected proposal appends proposed → rejected and leaves the graph unchanged", () => {
    const { state, appended } = applyProposals({
      schema,
      state: seeded(),
      proposals: [m.patchObject("task", objectId("ghost"), { status: "done" })],
      actor: "planner",
      causedBy: 1,
      at: stamp.at,
      ids,
    });
    expect(appended.map((e) => e.type)).toEqual(["patch.proposed", "patch.rejected"]);
    expect(appended[1]?.payload).toMatchObject({ rejection: { reason: "unknown_object" } });
    expect(state.graph.objects.size).toBe(0);
  });

  test("emit appends the custom event directly, without a patch wrapper", () => {
    const { appended } = applyProposals({
      schema,
      state: seeded(),
      proposals: [m.emit("task.completed", { taskId: "t1" })],
      actor: "planner",
      causedBy: 1,
      at: stamp.at,
      ids,
    });
    expect(appended.map((e) => e.type)).toEqual(["task.completed"]);
    expect(appended[0]?.causedBy).toBe(1);
  });

  test("later proposals see earlier effects — same-baseVersion patches conflict", () => {
    const base = applyProposals({
      schema,
      state: seeded(),
      proposals: [m.addObject("task", { title: "A", status: "open" }, { id: objectId("t1") })],
      actor: "seed",
      causedBy: 1,
      at: stamp.at,
      ids,
    }).state;
    const { state, appended } = applyProposals({
      schema,
      state: base,
      proposals: [
        m.patchObject("task", objectId("t1"), { status: "done" }, { baseVersion: 1 }),
        m.patchObject("task", objectId("t1"), { title: "B" }, { baseVersion: 1 }),
      ],
      actor: "racer",
      causedBy: 1,
      at: stamp.at,
      ids,
    });
    const kinds = appended.map((e) => e.type);
    expect(kinds).toEqual([
      "patch.proposed",
      "patch.applied",
      "object.patched",
      "patch.proposed",
      "patch.rejected",
    ]);
    expect(appended[4]?.payload).toMatchObject({
      rejection: { reason: "version_conflict", expected: 1, actual: 2 },
    });
    expect(state.graph.objects.get("t1")).toMatchObject({
      version: 2,
      data: { title: "A", status: "done" },
    });
  });
});

describe("settleStep", () => {
  test("orders started → patches → completed per behavior, in registry order", () => {
    const plan = dispatchOf(planStep({ state: seeded(), behaviors: [], budget: {}, stamp }));
    const outcomes: BehaviorOutcome<S1>[] = [
      {
        behavior: "planner",
        result: ok([m.addObject("task", { title: "A", status: "open" })]),
        trace: [],
      },
      { behavior: "grump", result: err({ reason: "exploded" }), trace: [] },
    ];
    const { state, appended } = settleStep({ schema, plan, outcomes, stamp, ids });
    expect(appended.map((e) => e.type)).toEqual([
      "behavior.started",
      "patch.proposed",
      "patch.applied",
      "object.created",
      "behavior.completed",
      "behavior.started",
      "behavior.failed",
    ]);
    expect(appended.at(-1)?.payload).toMatchObject({ behavior: "grump", reason: "exploded" });
    expect(appended.every((e) => e.causedBy === plan.event.id)).toBe(true);
    // Everything appended is also enqueued and applied.
    expect(state.queue.length).toBe(appended.length);
    expect(state.graph.objects.size).toBe(1);
  });

  test("llm and tool trace entries become paired request/response events", () => {
    const plan = dispatchOf(planStep({ state: seeded(), behaviors: [], budget: {}, stamp }));
    const outcomes: BehaviorOutcome<S1>[] = [
      {
        behavior: "asker",
        result: ok([]),
        trace: [
          {
            kind: "llm",
            requestHash: "abc",
            request: { prompt: "p" },
            response: { text: "r" },
            cached: false,
          },
          { kind: "tool", tool: "search", input: { q: "x" }, output: { hits: 1 }, isError: false },
        ],
      },
    ];
    const { appended } = settleStep({ schema, plan, outcomes, stamp, ids });
    expect(appended.map((e) => e.type)).toEqual([
      "behavior.started",
      "llm.requested",
      "llm.responded",
      "tool.requested",
      "tool.responded",
      "behavior.completed",
    ]);
    const requested = appended[1]?.payload as { requestId: string; requestHash: string };
    const responded = appended[2]?.payload as { requestId: string; requestHash: string };
    expect(requested.requestId).toBe(responded.requestId);
    expect(requested.requestHash).toBe("abc");
  });

  test("approval-gated mutations park behind approval.proposed and release on grant", () => {
    const gate = kit.behavior({
      name: "gate",
      on: ["goal.created"],
      run: (_event, ctx) => [
        ctx.m.addObject("task", { title: "Sensitive", status: "open" }, { requiresApproval: true }),
      ],
    });
    let state = seeded();
    const plan = dispatchOf(planStep({ state, behaviors: [gate], budget: {}, stamp }));
    const outcomes: BehaviorOutcome<S1>[] = [
      {
        behavior: "gate",
        result: ok([
          m.addObject("task", { title: "Sensitive", status: "open" }, { requiresApproval: true }),
        ]),
        trace: [],
      },
    ];
    const settled = settleStep({ schema, plan, outcomes, stamp, ids });
    state = settled.state;
    const proposal = settled.appended.find((e) => e.type === "approval.proposed");
    expect(proposal).toBeDefined();
    expect(state.graph.objects.size).toBe(0);
    expect(state.pendingApprovals.size).toBe(1);
    const approvalId = (proposal!.payload as { approvalId: string }).approvalId;

    // Drain the queue without behaviors, then grant.
    while (true) {
      const next = planStep({ state, behaviors: [], budget: {}, stamp });
      if (next.kind === "stop") break;
      state =
        next.kind === "dispatch"
          ? settleStep({ schema, plan: next, outcomes: [], stamp, ids }).state
          : next.state;
    }
    state = appendExternal({
      state,
      entries: [{ type: "approval.granted", payload: { approvalId } }],
      at: stamp.at,
    }).state;
    const grantPlan = dispatchOf(planStep({ state, behaviors: [], budget: {}, stamp }));
    const released = settleStep({ schema, plan: grantPlan, outcomes: [], stamp, ids });
    expect(released.appended.map((e) => e.type)).toEqual([
      "patch.proposed",
      "patch.applied",
      "object.created",
    ]);
    expect(released.state.graph.objects.size).toBe(1);
    expect(released.state.pendingApprovals.size).toBe(0);
  });

  test("bookkeeping-only settles do not re-arm the idle latch", () => {
    // Reach idle, then dispatch the idle event to a behavior that proposes nothing.
    const lurker = kit.behavior({ name: "lurker", on: ["runtime.idle"], run: () => [] });
    let state = seeded();
    const first = dispatchOf(planStep({ state, behaviors: [lurker], budget: {}, stamp }));
    state = settleStep({ schema, plan: first, outcomes: [], stamp, ids }).state;
    const idlePlan = planStep({ state, behaviors: [lurker], budget: {}, stamp });
    if (idlePlan.kind !== "idle") throw new Error("expected idle");
    state = idlePlan.state;
    const idleDispatch = dispatchOf(planStep({ state, behaviors: [lurker], budget: {}, stamp }));
    const settled = settleStep({
      schema,
      plan: idleDispatch,
      outcomes: [{ behavior: "lurker", result: ok([]), trace: [] }],
      stamp,
      ids,
    });
    // started/completed were appended, but status stays out of "running"...
    expect(settled.state.status).not.toBe("running");
    // ...so the drain terminates instead of emitting runtime.idle forever.
    let cursor = settled.state;
    for (let i = 0; i < 10; i++) {
      const next = planStep({ state: cursor, behaviors: [lurker], budget: {}, stamp });
      if (next.kind === "stop") break;
      cursor =
        next.kind === "dispatch"
          ? settleStep({
              schema,
              plan: next,
              outcomes: next.matches.map((b) => ({ behavior: b.name, result: ok([]), trace: [] })),
              stamp,
              ids,
            }).state
          : next.state;
    }
    expect(planStep({ state: cursor, behaviors: [lurker], budget: {}, stamp }).kind).toBe("stop");
  });
});
