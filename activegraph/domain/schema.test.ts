import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineSchema, objectId, relationId } from "./schema";

describe("defineSchema", () => {
  test("is an identity builder — the value passes through untouched", () => {
    const input = {
      objects: { task: z.object({ title: z.string() }) },
      relations: { depends_on: { source: "task", target: "task" } },
      events: { "task.completed": z.object({ taskId: z.string() }) },
    } as const;
    expect(defineSchema(input)).toBe(input);
  });

  test("id constructors brand plain strings without changing them", () => {
    expect(objectId<"task">("t1")).toBe("t1" as ReturnType<typeof objectId<"task">>);
    expect(relationId("r1")).toBe(relationId("r1"));
    expect(String(objectId<"task">("t1"))).toBe("t1");
  });
});
