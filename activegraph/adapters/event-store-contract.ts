/**
 * The shared EventStore contract — one behavioral suite every store adapter
 * must pass (memory and sqlite today; any future backend joins by calling
 * `describeEventStoreContract` from its colocated test). The contract is the
 * port's real spec: id contiguity, head accounting, fork overlay reads, and
 * range filtering.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { unwrap } from "../lib/fp";
import type { AnyEvent } from "../domain/events";
import { defineSchema } from "../domain/schema";
import type { EventStore } from "../ports/event-store";

export const contractSchema = defineSchema({
  objects: { task: z.object({ title: z.string() }) },
  relations: {},
  events: { ping: z.object({ n: z.number() }) },
});
export type ContractSchema = typeof contractSchema;

export const contractEvent = (
  id: number,
  branch: string,
  payload: unknown = { n: id },
): AnyEvent<ContractSchema> =>
  ({
    id,
    branch,
    type: "ping",
    payload,
    causedBy: null,
    at: "2026-01-01T00:00:00.000Z",
  }) as AnyEvent<ContractSchema>;

export const describeEventStoreContract = (
  label: string,
  makeStore: () => EventStore<ContractSchema>,
): void => {
  describe(`EventStore contract: ${label}`, () => {
    test("append then read roundtrips events in order; head tracks the last id", async () => {
      const store = makeStore();
      unwrap(await store.append([contractEvent(1, "main"), contractEvent(2, "main")]));
      unwrap(await store.append([contractEvent(3, "main")]));
      const events = unwrap(await store.read({ branch: "main" }));
      expect(events.map((e) => e.id)).toEqual([1, 2, 3]);
      expect(events[0]?.payload).toEqual({ n: 1 });
      expect(unwrap(await store.head("main"))).toBe(3);
    });

    test("an empty root branch heads at 0 and appends enforce contiguity", async () => {
      const store = makeStore();
      unwrap(await store.append([contractEvent(1, "main")]));
      const gap = await store.append([contractEvent(5, "main")]);
      expect(gap).toMatchObject({ ok: false, error: { reason: "id_gap", expected: 2, got: 5 } });
      expect(unwrap(await store.head("main"))).toBe(1);
    });

    test("reading an unknown branch is an unknown_branch error, not an empty list", async () => {
      const store = makeStore();
      const missing = await store.read({ branch: "nowhere" });
      expect(missing).toMatchObject({ ok: false, error: { reason: "unknown_branch" } });
    });

    test("createBranch rejects duplicates and unknown parents", async () => {
      const store = makeStore();
      unwrap(await store.append([contractEvent(1, "main")]));
      unwrap(await store.createBranch({ name: "fork", parent: "main", baseEventId: 1 }));
      expect(await store.createBranch({ name: "fork", parent: "main", baseEventId: 1 })).toMatchObject({
        ok: false,
        error: { reason: "branch_exists" },
      });
      expect(
        await store.createBranch({ name: "orphan", parent: "ghost", baseEventId: 1 }),
      ).toMatchObject({ ok: false, error: { reason: "unknown_branch" } });
      expect(unwrap(await store.branch("fork"))).toEqual({
        name: "fork",
        parent: "main",
        baseEventId: 1,
      });
      expect(unwrap(await store.branch("ghost"))).toBeNull();
    });

    test("fork reads overlay the parent prefix up to the base, then own events", async () => {
      const store = makeStore();
      unwrap(
        await store.append([contractEvent(1, "main"), contractEvent(2, "main"), contractEvent(3, "main")]),
      );
      unwrap(await store.createBranch({ name: "fork", parent: "main", baseEventId: 2 }));
      expect(unwrap(await store.head("fork"))).toBe(2);
      // The fork continues its own id sequence from the base...
      unwrap(await store.append([contractEvent(3, "fork", { n: 33 })]));
      // ...and later parent growth stays invisible past the base.
      unwrap(await store.append([contractEvent(4, "main")]));
      const events = unwrap(await store.read({ branch: "fork" }));
      expect(events.map((e) => [e.id, (e.payload as { n: number }).n])).toEqual([
        [1, 1],
        [2, 2],
        [3, 33],
      ]);
      expect(unwrap(await store.read({ branch: "main" }))).toHaveLength(4);
    });

    test("chained forks overlay recursively", async () => {
      const store = makeStore();
      unwrap(await store.append([contractEvent(1, "main"), contractEvent(2, "main")]));
      unwrap(await store.createBranch({ name: "f1", parent: "main", baseEventId: 2 }));
      unwrap(await store.append([contractEvent(3, "f1", { n: 31 })]));
      unwrap(await store.createBranch({ name: "f2", parent: "f1", baseEventId: 3 }));
      unwrap(await store.append([contractEvent(4, "f2", { n: 42 })]));
      const events = unwrap(await store.read({ branch: "f2" }));
      expect(events.map((e) => (e.payload as { n: number }).n)).toEqual([1, 2, 31, 42]);
    });

    test("fromId/toId bound reads inclusively", async () => {
      const store = makeStore();
      unwrap(
        await store.append([
          contractEvent(1, "main"),
          contractEvent(2, "main"),
          contractEvent(3, "main"),
          contractEvent(4, "main"),
        ]),
      );
      const middle = unwrap(await store.read({ branch: "main", fromId: 2, toId: 3 }));
      expect(middle.map((e) => e.id)).toEqual([2, 3]);
    });
  });
};
