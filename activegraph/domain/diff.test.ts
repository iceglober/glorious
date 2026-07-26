import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { diffGraphs, diffToMutations, emptyDiff } from "./diff";
import type { AnyEvent } from "./events";
import { project } from "./graph";
import { defineSchema } from "./schema";

const schema = defineSchema({
  objects: {
    task: z.object({ title: z.string(), status: z.enum(["open", "done"]) }),
  },
  relations: { depends_on: { source: "task", target: "task" } },
  events: {},
});
type S1 = typeof schema;

const ev = (id: number, type: string, payload: unknown) =>
  ({
    id,
    branch: "main",
    type,
    payload,
    causedBy: null,
    at: "2026-01-01T00:00:00.000Z",
  }) as AnyEvent<S1>;

const baseLog: AnyEvent<S1>[] = [
  ev(1, "object.created", {
    objectId: "t1",
    objectType: "task",
    data: { title: "A", status: "open" },
  }),
  ev(2, "object.created", {
    objectId: "t2",
    objectType: "task",
    data: { title: "B", status: "open" },
  }),
  ev(3, "relation.created", {
    relationId: "r1",
    relationType: "depends_on",
    source: "t1",
    target: "t2",
  }),
];

describe("diffGraphs", () => {
  test("identical graphs diff to empty", () => {
    const diff = diffGraphs(project<S1>(baseLog), project<S1>(baseLog));
    expect(emptyDiff(diff)).toBe(true);
  });

  test("detects added, changed, and removed objects and relations", () => {
    const headLog: AnyEvent<S1>[] = [
      ...baseLog,
      ev(4, "object.patched", {
        objectId: "t1",
        objectType: "task",
        patch: { status: "done" },
        baseVersion: 1,
        version: 2,
      }),
      ev(5, "object.created", {
        objectId: "t3",
        objectType: "task",
        data: { title: "C", status: "open" },
      }),
      ev(6, "relation.created", {
        relationId: "r2",
        relationType: "depends_on",
        source: "t2",
        target: "t3",
      }),
      ev(7, "object.removed", { objectId: "t2", objectType: "task" }),
    ];
    // Removing t2 cascades away r1 and r2, so the head keeps only t1(changed) + t3(new).
    const diff = diffGraphs(project<S1>(baseLog), project<S1>(headLog));
    expect(diff.addedObjects.map((o) => String(o.id))).toEqual(["t3"]);
    expect(diff.removedObjects.map((o) => String(o.id))).toEqual(["t2"]);
    expect(diff.changedObjects).toHaveLength(1);
    expect(diff.changedObjects[0]).toMatchObject({ patch: { status: "done" } });
    expect(diff.changedObjects[0]?.before.version).toBe(1);
    expect(diff.addedRelations).toHaveLength(0);
    expect(diff.removedRelations.map((r) => String(r.id))).toEqual(["r1"]);
  });
});

describe("diffToMutations", () => {
  test("orders removals first and carries fork ids and optimistic baseVersions", () => {
    const headLog: AnyEvent<S1>[] = [
      ...baseLog,
      ev(4, "object.patched", {
        objectId: "t1",
        objectType: "task",
        patch: { title: "A2" },
        baseVersion: 1,
        version: 2,
      }),
      ev(5, "object.created", {
        objectId: "t3",
        objectType: "task",
        data: { title: "C", status: "open" },
      }),
      ev(6, "relation.created", {
        relationId: "r2",
        relationType: "depends_on",
        source: "t1",
        target: "t3",
      }),
    ];
    const diff = diffGraphs(project<S1>(baseLog), project<S1>(headLog));
    const mutations = diffToMutations(schema, diff);
    expect(mutations.map((mutation) => mutation.kind)).toEqual([
      "addObject",
      "patchObject",
      "addRelation",
    ]);
    expect(mutations[0]).toMatchObject({ kind: "addObject", id: "t3" });
    expect(mutations[1]).toMatchObject({
      kind: "patchObject",
      objectId: "t1",
      patch: { title: "A2" },
      baseVersion: 1,
    });
    expect(mutations[2]).toMatchObject({ kind: "addRelation", id: "r2" });
  });
});
