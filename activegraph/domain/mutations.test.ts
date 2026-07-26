import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AnyEvent } from "./events";
import { project } from "./graph";
import { createMutations, toSnapshot, validateMutation, type Mutation } from "./mutations";
import { defineSchema, objectId, relationId } from "./schema";

const schema = defineSchema({
  objects: {
    task: z.object({ title: z.string(), status: z.enum(["open", "done"]) }),
    note: z.object({ text: z.string() }),
  },
  relations: {
    depends_on: { source: "task", target: "task" },
  },
  events: { "task.completed": z.object({ taskId: z.string() }) },
});
type S1 = typeof schema;
const m = createMutations(schema);

const ev = (id: number, type: string, payload: unknown) =>
  ({ id, branch: "main", type, payload, causedBy: null, at: "2026-01-01T00:00:00.000Z" }) as AnyEvent<S1>;

const graph = () =>
  project<S1>([
    ev(1, "object.created", { objectId: "t1", objectType: "task", data: { title: "A", status: "open" } }),
    ev(2, "object.created", { objectId: "n1", objectType: "note", data: { text: "hi" } }),
    ev(3, "relation.created", { relationId: "r1", relationType: "depends_on", source: "t1", target: "t1" }),
    ev(4, "object.patched", { objectId: "t1", objectType: "task", patch: { status: "done" }, baseVersion: 1, version: 2 }),
  ]);

const validate = (mutation: Mutation<S1>) => validateMutation({ schema, graph: graph(), mutation });

describe("builder", () => {
  test("constructors are inert taggers producing serializable values", () => {
    const mutation = m.addObject("task", { title: "T", status: "open" }, { id: objectId("tX") });
    expect(toSnapshot(mutation)).toEqual({
      kind: "addObject",
      objectType: "task",
      data: { title: "T", status: "open" },
      id: "tX",
    });
    expect(toSnapshot(m.emit("task.completed", { taskId: "t1" }))).toEqual({
      kind: "emit",
      type: "task.completed",
      payload: { taskId: "t1" },
    });
  });
});

describe("validateMutation", () => {
  test("accepts well-formed proposals of every kind", () => {
    expect(validate(m.addObject("task", { title: "B", status: "open" })).ok).toBe(true);
    expect(validate(m.patchObject("task", objectId("t1"), { title: "A2" })).ok).toBe(true);
    expect(validate(m.removeObject(objectId("n1"))).ok).toBe(true);
    expect(validate(m.addRelation("depends_on", objectId("t1"), objectId("t1"))).ok).toBe(true);
    expect(validate(m.removeRelation(relationId("r1"))).ok).toBe(true);
    expect(validate(m.emit("task.completed", { taskId: "t1" })).ok).toBe(true);
  });

  test("rejects data failing the object type's zod schema as schema_invalid", () => {
    const bad = m.addObject("task", { title: "B", status: "nope" } as never);
    const verdict = validate(bad);
    expect(verdict).toMatchObject({ ok: false, error: { reason: "schema_invalid" } });
  });

  test("rejects a patch whose merged result fails the schema", () => {
    const bad = m.patchObject("task", objectId("t1"), { status: "sideways" } as never);
    expect(validate(bad)).toMatchObject({ ok: false, error: { reason: "schema_invalid" } });
  });

  test("rejects a stale baseVersion as version_conflict with both versions", () => {
    const stale = m.patchObject("task", objectId("t1"), { title: "A3" }, { baseVersion: 1 });
    expect(validate(stale)).toMatchObject({
      ok: false,
      error: { reason: "version_conflict", expected: 1, actual: 2 },
    });
    const fresh = m.patchObject("task", objectId("t1"), { title: "A3" }, { baseVersion: 2 });
    expect(validate(fresh).ok).toBe(true);
  });

  test("rejects unknown objects and relations", () => {
    expect(validate(m.patchObject("task", objectId("ghost"), {}))).toMatchObject({
      ok: false,
      error: { reason: "unknown_object", objectId: "ghost" },
    });
    expect(validate(m.removeObject(objectId("ghost")))).toMatchObject({
      ok: false,
      error: { reason: "unknown_object" },
    });
    expect(validate(m.removeRelation(relationId("ghost")))).toMatchObject({
      ok: false,
      error: { reason: "unknown_relation", relationId: "ghost" },
    });
  });

  test("rejects an explicit id that already exists as duplicate_id", () => {
    const dup = m.addObject("task", { title: "B", status: "open" }, { id: objectId("t1") });
    expect(validate(dup)).toMatchObject({ ok: false, error: { reason: "duplicate_id", objectId: "t1" } });
  });

  test("rejects relation endpoints whose runtime object type mismatches the declaration", () => {
    // Compile-time branding prevents this for honest callers; ids crossing a
    // serialization boundary can still smuggle a note where a task belongs.
    const smuggled = m.addRelation("depends_on", objectId("n1"), objectId("t1"));
    expect(validate(smuggled)).toMatchObject({
      ok: false,
      error: { reason: "endpoint_type_mismatch", end: "source", expected: "task", actual: "note" },
    });
  });

  test("rejects emits with undeclared names or bad payloads", () => {
    const undeclared = { kind: "emit", type: "task.exploded", payload: {} } as unknown as Mutation<S1>;
    expect(validate(undeclared)).toMatchObject({ ok: false, error: { reason: "schema_invalid" } });
    const badPayload = m.emit("task.completed", { taskId: 42 } as never);
    expect(validate(badPayload)).toMatchObject({ ok: false, error: { reason: "schema_invalid" } });
  });
});
