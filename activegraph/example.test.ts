import { describe, expect, test } from "bun:test";
import { exampleBehaviors, exampleSchema } from "./example";

describe("the example module", () => {
  test("exports the four pipeline behaviors in registry order", () => {
    expect(exampleBehaviors.map((b) => b.name)).toEqual([
      "planner",
      "wirer",
      "researcher",
      "unblock",
    ]);
  });

  test("declares the task/claim schema with a depends_on relation", () => {
    expect(Object.keys(exampleSchema.objects)).toEqual(["task", "claim"]);
    expect(exampleSchema.relations.depends_on).toEqual({ source: "task", target: "task" });
  });
});
