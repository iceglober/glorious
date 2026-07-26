import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AnyEvent } from "./events";
import { project } from "./graph";
import { defineSchema, objectId } from "./schema";
import { createGraphView } from "./view";

const schema = defineSchema({
  objects: {
    task: z.object({ title: z.string(), status: z.enum(["open", "done"]) }),
    note: z.object({ text: z.string() }),
  },
  relations: {
    depends_on: { source: "task", target: "task" },
    annotates: { source: "note", target: "task" },
  },
  events: { "task.completed": z.object({ taskId: z.string() }) },
});
type S1 = typeof schema;

const ev = (id: number, type: string, payload: unknown, causedBy: number | null = null) =>
  ({ id, branch: "main", type, payload, causedBy, at: "2026-01-01T00:00:00.000Z" }) as AnyEvent<S1>;

const log: AnyEvent<S1>[] = [
  ev(1, "goal.created", { goalId: "g1", text: "go" }),
  ev(2, "task.completed", { taskId: "warmup" }, 1),
  ev(3, "object.created", { objectId: "t1", objectType: "task", data: { title: "A", status: "open" } }, 2),
  ev(4, "object.created", { objectId: "t2", objectType: "task", data: { title: "B", status: "open" } }, 1),
  ev(5, "object.created", { objectId: "n1", objectType: "note", data: { text: "hello" } }, 1),
  ev(6, "relation.created", { relationId: "r1", relationType: "depends_on", source: "t1", target: "t2" }, 1),
  ev(7, "relation.created", { relationId: "r2", relationType: "annotates", source: "n1", target: "t1" }, 1),
];

const view = () => createGraphView({ state: project<S1>(log), log });

describe("createGraphView", () => {
  test("objects(type) returns only that type, fully typed", () => {
    const tasks = view().objects("task");
    expect(tasks.map((t) => String(t.id)).sort()).toEqual(["t1", "t2"]);
    // Compile-time: t.data.status is "open" | "done".
    expect(tasks.every((t) => t.data.status === "open")).toBe(true);
    expect(view().objects("note")).toHaveLength(1);
  });

  test("object(id) looks up a single object", () => {
    expect(view().object(objectId<"task">("t1"))?.data.title).toBe("A");
    expect(view().object(objectId<"task">("ghost"))).toBeUndefined();
  });

  test("relations(type) and relationsOf(id) filter typed edges", () => {
    expect(view().relations("depends_on").map((r) => String(r.id))).toEqual(["r1"]);
    const ofT1 = view().relationsOf(objectId<"task">("t1"));
    expect(ofT1.map((r) => String(r.id)).sort()).toEqual(["r1", "r2"]);
    expect(view().relationsOf(objectId<"task">("t2")).map((r) => String(r.id))).toEqual(["r1"]);
  });

  test("recentEvents returns the log tail, newest last", () => {
    expect(view().recentEvents(2).map((e) => e.id)).toEqual([6, 7]);
    expect(view().recentEvents().length).toBe(log.length);
  });

  test("provenance walks the causedBy chain from external input to creation", () => {
    const chain = view().provenance(objectId<"task">("t1"));
    // goal.created -> task.completed -> the object.created event itself
    expect(chain.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(view().provenance(objectId<"task">("ghost"))).toEqual([]);
  });
});
