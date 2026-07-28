import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createFixedClock } from "../adapters/clocks";
import { createScriptedLlm } from "../adapters/fake-llm";
import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import { createKit } from "../domain/behaviors";
import { canonicalLog } from "../domain/events";
import { createMutations } from "../domain/mutations";
import { defineSchema } from "../domain/schema";
import { type ExampleSchema, exampleBehaviors, exampleSchema } from "../example";
import { unwrap } from "../lib/fp";
import { createRuntime, type Runtime } from "./runtime";

const makeExampleRuntime = async (): Promise<Runtime<ExampleSchema>> =>
  unwrap(
    await createRuntime({
      schema: exampleSchema,
      behaviors: exampleBehaviors,
      eventStore: createMemoryEventStore(),
      graphStore: createMemoryGraphStore(),
      clock: createFixedClock(),
    }),
  );

describe("the example pipeline (planner → wirer → researcher → unblock)", () => {
  test("runGoal drives the scenario to idle with the memo unblocked", async () => {
    const runtime = await makeExampleRuntime();
    const status = unwrap(await runtime.runGoal("Evaluate this startup idea"));
    expect(status.status).toBe("idle");
    expect(status.queueDepth).toBe(0);

    const view = runtime.view();
    const tasks = view.objects("task");
    const memo = tasks.find((t) => t.data.title === "Draft memo");
    const research = tasks.find((t) => t.data.title === "Research");
    expect(research?.data.status).toBe("open");
    expect(memo?.data.status).toBe("open"); // unblocked by the relation behavior
    expect(memo?.version).toBe(2); // created blocked, patched open
    expect(view.objects("claim")).toHaveLength(1);
    expect(view.relations("depends_on")).toHaveLength(1);
    expect(runtime.log().some((e) => (e.type as string) === "task.completed")).toBe(true);
    expect(runtime.log().some((e) => (e.type as string) === "runtime.idle")).toBe(true);
  });

  test("two runs from scratch produce byte-identical canonical logs — the determinism contract", async () => {
    const a = await makeExampleRuntime();
    const b = await makeExampleRuntime();
    unwrap(await a.runGoal("Evaluate this startup idea"));
    unwrap(await b.runGoal("Evaluate this startup idea"));
    expect(a.log().length).toBeGreaterThan(10);
    expect(canonicalLog(a.log())).toBe(canonicalLog(b.log()));
  });

  test("provenance of the claim chains back to the goal", async () => {
    const runtime = await makeExampleRuntime();
    unwrap(await runtime.runGoal("Evaluate"));
    const view = runtime.view();
    const claim = view.objects("claim")[0];
    if (claim === undefined) throw new Error("claim missing");
    const chain = view.provenance(claim.id).map((e) => e.type as string);
    expect(chain[0]).toBe("goal.created");
    expect(chain.at(-1)).toBe("object.created");
  });

  test("runQuantum advances exactly one dispatched event", async () => {
    const runtime = await makeExampleRuntime();
    unwrap(await runtime.emit("task.completed", { taskId: "nobody" }));
    const before = runtime.status().processed;
    const first = unwrap(await runtime.runQuantum());
    expect(first.stepped).toBe("dispatch");
    expect(first.status.processed).toBe(before + 1);
    // Queue drained; next quantum emits idle, then dispatches it, then stops.
    expect(unwrap(await runtime.runQuantum()).stepped).toBe("idle");
    expect(unwrap(await runtime.runQuantum()).stepped).toBe("dispatch");
    expect(unwrap(await runtime.runQuantum()).stepped).toBe("stop");
  });

  test("a rehydrated runtime continues the same log and reuses state", async () => {
    const eventStore = createMemoryEventStore<ExampleSchema>();
    const first = unwrap(
      await createRuntime({
        schema: exampleSchema,
        behaviors: exampleBehaviors,
        eventStore,
        graphStore: createMemoryGraphStore<ExampleSchema>(),
        clock: createFixedClock(),
      }),
    );
    unwrap(await first.runGoal("Evaluate"));
    const head = first.status().headEventId;

    const second = unwrap(
      await createRuntime({
        schema: exampleSchema,
        behaviors: exampleBehaviors,
        eventStore,
        graphStore: createMemoryGraphStore<ExampleSchema>(),
        clock: createFixedClock(),
      }),
    );
    expect(second.status().headEventId).toBe(head);
    expect(second.view().objects("task")).toHaveLength(2);
    unwrap(await second.emit("task.completed", { taskId: "nobody" }));
    expect(second.status().headEventId).toBe(head + 1);
  });
});

describe("budgets", () => {
  test("a runaway behavior is stopped by maxEvents with a budget_exhausted marker", async () => {
    const schema = defineSchema({
      objects: {},
      relations: {},
      events: { tick: z.object({ n: z.number() }) },
    });
    const kit = createKit(schema);
    const runaway = kit.behavior({
      name: "runaway",
      on: ["tick"],
      run: (event, ctx) =>
        event.type === "tick" ? [ctx.m.emit("tick", { n: event.payload.n + 1 })] : [],
    });
    const runtime = unwrap(
      await createRuntime({
        schema,
        behaviors: [runaway],
        eventStore: createMemoryEventStore<typeof schema>(),
        graphStore: createMemoryGraphStore<typeof schema>(),
        clock: createFixedClock(),
        budget: { maxEvents: 30 },
      }),
    );
    unwrap(await runtime.emit("tick", { n: 0 }));
    const status = unwrap(await runtime.runUntilIdle());
    expect(status.status).toBe("budget_exhausted");
    expect(status.processed).toBe(30);
    expect(runtime.log().some((e) => (e.type as string) === "runtime.budget_exhausted")).toBe(true);
  });
});

describe("approval gating", () => {
  test("a gated mutation parks until grantApproval releases it through the normal pipeline", async () => {
    const schema = defineSchema({
      objects: { secret: z.object({ name: z.string() }) },
      relations: {},
      events: {},
    });
    const kit = createKit(schema);
    const gated = kit.behavior({
      name: "gated",
      on: ["goal.created"],
      run: (_event, ctx) => [
        ctx.m.addObject("secret", { name: "launch codes" }, { requiresApproval: true }),
      ],
    });
    const runtime = unwrap(
      await createRuntime({
        schema,
        behaviors: [gated],
        eventStore: createMemoryEventStore<typeof schema>(),
        graphStore: createMemoryGraphStore<typeof schema>(),
        clock: createFixedClock(),
      }),
    );
    const parked = unwrap(await runtime.runGoal("do the sensitive thing"));
    expect(parked.pendingApprovals).toHaveLength(1);
    expect(runtime.view().objects("secret")).toHaveLength(0);

    const approvalId = parked.pendingApprovals[0] ?? "";
    unwrap(await runtime.grantApproval(approvalId));
    const released = unwrap(await runtime.runUntilIdle());
    expect(released.pendingApprovals).toHaveLength(0);
    expect(runtime.view().objects("secret")).toHaveLength(1);
  });
});

describe("llm behaviors through the runtime", () => {
  const schema = defineSchema({
    objects: { claim: z.object({ text: z.string() }) },
    relations: {},
    events: {},
  });
  const kit = createKit(schema);
  const summarizer = kit.llmBehavior({
    name: "summarizer",
    on: ["goal.created"],
    prompt: (event) => ({
      prompt: `summarize: ${event.type === "goal.created" ? event.payload.text : ""}`,
    }),
    output: z.object({ text: z.string() }),
    andThen: (output, _event, ctx) => [ctx.m.addObject("claim", { text: output.text })],
  });

  test("llm calls surface as paired llm.requested/llm.responded events with one hash", async () => {
    const runtime = unwrap(
      await createRuntime({
        schema,
        behaviors: [summarizer],
        eventStore: createMemoryEventStore<typeof schema>(),
        graphStore: createMemoryGraphStore<typeof schema>(),
        clock: createFixedClock(),
        llm: createScriptedLlm([JSON.stringify({ text: "looks promising" })]),
      }),
    );
    unwrap(await runtime.runGoal("evaluate the market"));
    const types = runtime.log().map((e) => e.type as string);
    expect(types).toContain("llm.requested");
    expect(types).toContain("llm.responded");
    const requested = runtime.log().find((e) => (e.type as string) === "llm.requested");
    const responded = runtime.log().find((e) => (e.type as string) === "llm.responded");
    expect((requested!.payload as { requestHash: string }).requestHash).toBe(
      (responded!.payload as { requestHash: string }).requestHash,
    );
    expect((responded!.payload as { cached: boolean }).cached).toBe(false);
    expect(runtime.view().objects("claim")[0]?.data.text).toBe("looks promising");
  });

  test("a schema-failing completion becomes behavior.failed, not an exception", async () => {
    const runtime = unwrap(
      await createRuntime({
        schema,
        behaviors: [summarizer],
        eventStore: createMemoryEventStore<typeof schema>(),
        graphStore: createMemoryGraphStore<typeof schema>(),
        clock: createFixedClock(),
        llm: createScriptedLlm([JSON.stringify({ wrong: "shape" })]),
      }),
    );
    const status = unwrap(await runtime.runGoal("evaluate"));
    expect(status.status).toBe("idle");
    const failed = runtime.log().find((e) => (e.type as string) === "behavior.failed");
    expect((failed!.payload as { reason: string }).reason).toMatch(/failed schema/);
    expect(runtime.view().objects("claim")).toHaveLength(0);
  });

  test("emit validates custom payloads at the boundary", async () => {
    const runtime = await makeExampleRuntime();
    const invalid = await runtime.emit("task.completed", { taskId: 42 } as never);
    expect(invalid).toMatchObject({ ok: false, error: { reason: "invalid_payload" } });
  });
});

describe("propose", () => {
  test("runs external mutations through validate/apply with patch provenance", async () => {
    const exampleM = createMutations(exampleSchema);
    const runtime = await makeExampleRuntime();
    unwrap(await runtime.runGoal("Evaluate"));
    const memo = runtime
      .view()
      .objects("task")
      .find((t) => t.data.title === "Draft memo");
    if (memo === undefined) throw new Error("memo missing");
    const { appended } = unwrap(
      await runtime.propose([exampleM.patchObject("task", memo.id, { status: "done" })], {
        actor: "editor",
      }),
    );
    expect(appended.map((e) => e.type as string)).toEqual([
      "patch.proposed",
      "patch.applied",
      "object.patched",
    ]);
    expect(runtime.view().object(memo.id)?.data.status).toBe("done");
  });
});
