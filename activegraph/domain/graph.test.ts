import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { fold } from "../lib/fp";
import { type AnyEvent } from "./events";
import { applyEvent, emptyGraph, project } from "./graph";
import { defineSchema, objectId } from "./schema";

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

const sampleLog = (): AnyEvent<S1>[] => [
  ev(1, "goal.created", { goalId: "g1", text: "do things" }),
  ev(2, "object.created", { objectId: "t1", objectType: "task", data: { title: "A", status: "open" } }, 1),
  ev(3, "object.created", { objectId: "t2", objectType: "task", data: { title: "B", status: "open" } }, 1),
  ev(4, "object.created", { objectId: "n1", objectType: "note", data: { text: "hi" } }, 1),
  ev(5, "relation.created", { relationId: "r1", relationType: "depends_on", source: "t1", target: "t2" }, 1),
  ev(6, "relation.created", { relationId: "r2", relationType: "annotates", source: "n1", target: "t2" }, 1),
  ev(7, "object.patched", { objectId: "t1", objectType: "task", patch: { status: "done" }, baseVersion: 1, version: 2 }, 1),
];

describe("applyEvent", () => {
  test("object.created adds a versioned object with provenance event ids", () => {
    const state = project<S1>(sampleLog());
    const t1 = state.objects.get("t1");
    expect(t1).toMatchObject({ id: "t1", type: "task", version: 2, causedBy: 2, updatedBy: 7 });
    expect(t1?.data).toEqual({ title: "A", status: "done" });
  });

  test("object.patched merges data and sets the version from the event verbatim", () => {
    const state = project<S1>(sampleLog());
    expect(state.objects.get("t2")?.version).toBe(1);
    expect(state.objects.get("t1")?.version).toBe(2);
  });

  test("non-graph events are identity on the state", () => {
    const state = project<S1>(sampleLog());
    const after = applyEvent(state, ev(8, "task.completed", { taskId: "t1" }, 7));
    expect(after).toBe(state);
  });

  test("object.removed cascades to incident relations", () => {
    const log = [...sampleLog(), ev(8, "object.removed", { objectId: "t2", objectType: "task" }, 1)];
    const state = project<S1>(log);
    expect(state.objects.has("t2")).toBe(false);
    expect(state.relations.size).toBe(0); // r1 and r2 both touched t2
    expect(state.objects.has("t1")).toBe(true);
    expect(state.objects.has("n1")).toBe(true);
  });

  test("relation.removed removes only the named relation", () => {
    const log = [...sampleLog(), ev(8, "relation.removed", { relationId: "r1", relationType: "depends_on" }, 1)];
    const state = project<S1>(log);
    expect(state.relations.has("r1")).toBe(false);
    expect(state.relations.has("r2")).toBe(true);
  });

  test("patching or removing an unknown object is identity, not an error", () => {
    const empty = emptyGraph<S1>();
    expect(
      applyEvent(empty, ev(1, "object.patched", { objectId: "ghost", objectType: "task", patch: {}, baseVersion: 1, version: 2 })),
    ).toBe(empty);
    expect(applyEvent(empty, ev(1, "object.removed", { objectId: "ghost", objectType: "task" }))).toBe(empty);
  });

  test("does not mutate the input state — old snapshots stay valid", () => {
    const before = project<S1>(sampleLog().slice(0, 2));
    const sizeBefore = before.objects.size;
    applyEvent(before, ev(3, "object.created", { objectId: "tX", objectType: "task", data: { title: "X", status: "open" } }, 1));
    expect(before.objects.size).toBe(sizeBefore);
  });
});

describe("project", () => {
  test("applying the same log twice yields structurally identical graphs", () => {
    const a = project<S1>(sampleLog());
    const b = project<S1>(sampleLog());
    expect([...a.objects.entries()]).toEqual([...b.objects.entries()]);
    expect([...a.relations.entries()]).toEqual([...b.relations.entries()]);
  });

  test("fold of a concatenation equals fold composed — projection is a left fold", () => {
    const log = sampleLog();
    const whole = project<S1>(log);
    const half = project<S1>(log.slice(0, 4));
    const resumed = fold(applyEvent, half, log.slice(4));
    expect([...whole.objects.entries()]).toEqual([...resumed.objects.entries()]);
    expect([...whole.relations.entries()]).toEqual([...resumed.relations.entries()]);
  });

  test("typed reads: a task object's data carries the schema-inferred shape", () => {
    const state = project<S1>(sampleLog());
    const t1 = state.objects.get(objectId<"task">("t1"));
    // Compile-time: t1.data is { title: string; status: "open" | "done" } for concrete schemas.
    expect(t1?.data).toMatchObject({ title: "A" });
  });
});
