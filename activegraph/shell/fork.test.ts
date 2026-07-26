import { describe, expect, test } from "bun:test";
import { createFixedClock } from "../adapters/clocks";
import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import { createMutations } from "../domain/mutations";
import { type ExampleSchema, exampleBehaviors, exampleSchema } from "../example";
import { unwrap } from "../lib/fp";
import type { EventStore } from "../ports/event-store";
import { createFork, promote } from "./fork";
import { createRuntime, type Runtime } from "./runtime";

const m = createMutations(exampleSchema);

const makeRuntimeOn = async (
  eventStore: EventStore<ExampleSchema>,
  branch: string,
): Promise<Runtime<ExampleSchema>> =>
  unwrap(
    await createRuntime({
      schema: exampleSchema,
      behaviors: exampleBehaviors,
      eventStore,
      graphStore: createMemoryGraphStore(),
      clock: createFixedClock(),
      branch,
    }),
  );

const recordMain = async () => {
  const eventStore = createMemoryEventStore<ExampleSchema>();
  const main = await makeRuntimeOn(eventStore, "main");
  unwrap(await main.runGoal("Evaluate this startup idea"));
  return { eventStore, main };
};

const memoOf = (runtime: Runtime<ExampleSchema>) => {
  const memo = runtime
    .view()
    .objects("task")
    .find((t) => t.data.title === "Draft memo");
  if (memo === undefined) throw new Error("memo missing");
  return memo;
};

describe("createFork", () => {
  test("a fork at mid-history sees exactly the parent prefix", async () => {
    const { eventStore } = await recordMain();
    unwrap(await createFork({ store: eventStore, parent: "main", atEventId: 1, name: "early" }));
    const early = await makeRuntimeOn(eventStore, "early");
    expect(early.status().headEventId).toBe(1);
    expect(early.log().map((e) => e.type as string)).toEqual(["goal.created"]);
    expect(early.view().objects("task")).toHaveLength(0);
  });

  test("a fork diverges independently; the parent never sees fork events", async () => {
    const { eventStore, main } = await recordMain();
    const head = main.status().headEventId;
    unwrap(await createFork({ store: eventStore, parent: "main", atEventId: head, name: "alt" }));
    const alt = await makeRuntimeOn(eventStore, "alt");
    expect(alt.status().headEventId).toBe(head);

    const memo = memoOf(alt);
    unwrap(await alt.propose([m.patchObject("task", memo.id, { title: "Draft memo v2" })]));
    expect(alt.view().object(memo.id)?.data.title).toBe("Draft memo v2");
    expect(alt.status().headEventId).toBeGreaterThan(head);

    expect(memoOf(main).data.title).toBe("Draft memo");
    expect(unwrap(await eventStore.head("main"))).toBe(head);
  });

  test("rejects fork points outside the parent's history", async () => {
    const { eventStore, main } = await recordMain();
    const bad = await createFork({
      store: eventStore,
      parent: "main",
      atEventId: main.status().headEventId + 100,
      name: "overshoot",
    });
    expect(bad.ok).toBe(false);
  });
});

describe("promote", () => {
  test("applies a fork's delta to the parent through the normal pipeline", async () => {
    const { eventStore, main } = await recordMain();
    const head = main.status().headEventId;
    unwrap(await createFork({ store: eventStore, parent: "main", atEventId: head, name: "alt" }));
    const alt = await makeRuntimeOn(eventStore, "alt");
    const memo = memoOf(alt);
    unwrap(
      await alt.propose([
        m.patchObject("task", memo.id, { status: "done" }),
        m.addObject("claim", { text: "Competitors are slow.", confidence: 0.6 }),
      ]),
    );

    const result = unwrap(
      await promote({ schema: exampleSchema, store: eventStore, fork: "alt", parentRuntime: main }),
    );
    expect(result.applied).toBe(2);
    expect(result.rejected).toBe(0);
    expect(result.diff.changedObjects).toHaveLength(1);
    expect(result.diff.addedObjects).toHaveLength(1);
    expect(memoOf(main).data.status).toBe("done");
    expect(main.view().objects("claim")).toHaveLength(2);
  });

  test("a parent that moved on since the fork point rejects with version_conflict", async () => {
    const { eventStore, main } = await recordMain();
    const head = main.status().headEventId;
    unwrap(await createFork({ store: eventStore, parent: "main", atEventId: head, name: "race" }));
    const race = await makeRuntimeOn(eventStore, "race");

    // Parent and fork both patch the memo after the fork point.
    unwrap(await main.propose([m.patchObject("task", memoOf(main).id, { status: "done" })]));
    unwrap(
      await race.propose([m.patchObject("task", memoOf(race).id, { title: "Draft memo (raced)" })]),
    );

    const result = unwrap(
      await promote({
        schema: exampleSchema,
        store: eventStore,
        fork: "race",
        parentRuntime: main,
      }),
    );
    expect(result.applied).toBe(0);
    expect(result.rejected).toBe(1);
    const rejection = main
      .log()
      .find((e) => (e.type as string) === "patch.rejected" && e.causedBy === null);
    expect((rejection!.payload as { rejection: { reason: string } }).rejection.reason).toBe(
      "version_conflict",
    );
    // The parent's own change survives; the fork's conflicting title does not land.
    expect(memoOf(main).data).toMatchObject({ status: "done", title: "Draft memo" });
  });

  test("promoting an unknown or root branch is an error", async () => {
    const { eventStore, main } = await recordMain();
    expect(
      await promote({
        schema: exampleSchema,
        store: eventStore,
        fork: "ghost",
        parentRuntime: main,
      }),
    ).toMatchObject({ ok: false, error: { reason: "unknown_fork" } });
    expect(
      await promote({
        schema: exampleSchema,
        store: eventStore,
        fork: "main",
        parentRuntime: main,
      }),
    ).toMatchObject({ ok: false, error: { reason: "unknown_fork" } });
  });
});
