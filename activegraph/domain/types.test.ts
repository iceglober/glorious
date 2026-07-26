/**
 * The compile-time regression suite. Every `@ts-expect-error` line asserts
 * that the type system REJECTS an ill-formed program — if an API change makes
 * one of these compile, `tsc --noEmit` fails with "unused @ts-expect-error",
 * which is exactly the regression signal we want. The runtime assertions are
 * incidental; the test is the typecheck.
 */
import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createKit, whereObject } from "./behaviors";
import type { EventOf } from "./events";
import { createMutations } from "./mutations";
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

const m = createMutations(schema);
const kit = createKit(schema);
const taskId = objectId<"task">("t1");
const noteId = objectId<"note">("n1");

describe("compile-time contract", () => {
  test("addObject data is checked against the object type's zod schema", () => {
    const good = m.addObject("task", { title: "x", status: "open" });
    expect(good.kind).toBe("addObject");

    // @ts-expect-error missing required field `status`
    m.addObject("task", { title: "x" });
    // @ts-expect-error wrong field type
    m.addObject("note", { text: 42 });
    // @ts-expect-error unknown object type
    m.addObject("bogus", {});
  });

  test("relation endpoints are branded by object type", () => {
    const good = m.addRelation("depends_on", taskId, taskId);
    expect(good.kind).toBe("addRelation");
    const alsoGood = m.addRelation("annotates", noteId, taskId);
    expect(alsoGood.kind).toBe("addRelation");

    // @ts-expect-error a note id is not a task id
    m.addRelation("depends_on", noteId, taskId);
    // @ts-expect-error endpoints are ordered: annotates goes note -> task
    m.addRelation("annotates", taskId, noteId);
    // @ts-expect-error a bare string is not a branded ObjectId
    m.addRelation("depends_on", "t1", "t2");
  });

  test("patchObject patches are partial but shape-checked", () => {
    const good = m.patchObject("task", taskId, { status: "done" });
    expect(good.kind).toBe("patchObject");

    // @ts-expect-error unknown status literal
    m.patchObject("task", taskId, { status: "wat" });
    // @ts-expect-error a task id cannot patch a note
    m.patchObject("note", taskId, { text: "x" });
  });

  test("emit requires a declared custom event and its payload shape", () => {
    const good = m.emit("task.completed", { taskId: "t1" });
    expect(good.kind).toBe("emit");

    // @ts-expect-error unknown custom event name
    m.emit("task.exploded", {});
    // @ts-expect-error wrong payload shape
    m.emit("task.completed", { task: "t1" });
  });

  test("behavior `on` narrows the handler's event payload", () => {
    const b = kit.behavior({
      name: "narrowing",
      on: ["task.completed", "goal.created"],
      run: (event) => {
        // The union narrows by discriminant — no casts.
        if (event.type === "task.completed") {
          const taskRef: string = event.payload.taskId;
          expect(typeof taskRef).toBe("string");
        } else {
          const text: string = event.payload.text;
          expect(typeof text).toBe("string");
        }
        return [];
      },
    });
    expect(b.name).toBe("narrowing");

    kit.behavior({
      name: "bad",
      // @ts-expect-error unknown event name in `on`
      on: ["task.imaginary"],
      run: () => [],
    });
  });

  test("relation behaviors type their relation and its endpoints", () => {
    const b = kit.relationBehavior({
      name: "unblock",
      relationType: "depends_on",
      on: ["task.completed"],
      run: ({ relation, ctx }) => {
        // relation.target is ObjectId<"task">, so this patch call type-checks.
        return [ctx.m.patchObject("task", relation.target, { status: "open" })];
      },
    });
    expect(b.name).toBe("unblock");

    kit.relationBehavior({
      name: "bad",
      // @ts-expect-error unknown relation type
      relationType: "made_up",
      on: ["task.completed"],
      run: () => [],
    });
  });

  test("whereObject match keys come from the object type's data shape", () => {
    const pred = whereObject<S1, "task">("task", { status: "open" });
    expect(typeof pred).toBe("function");

    // @ts-expect-error unknown data key for task
    whereObject<S1, "task">("task", { flavour: "sour" });
  });

  test("typed event shape: EventOf resolves payloads for concrete schemas", () => {
    const event: EventOf<S1, "task.completed"> = {
      id: 1,
      branch: "main",
      type: "task.completed",
      payload: { taskId: "t1" },
      causedBy: null,
      at: "2026-01-01T00:00:00.000Z",
    };
    expect(event.payload.taskId).toBe("t1");

    const bad: EventOf<S1, "task.completed"> = {
      id: 1,
      branch: "main",
      type: "task.completed",
      // @ts-expect-error payload shape mismatch
      payload: { wrong: true },
      causedBy: null,
      at: "2026-01-01T00:00:00.000Z",
    };
    expect(bad.id).toBe(1);
  });
});
