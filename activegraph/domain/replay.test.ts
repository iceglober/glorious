import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { canonicalEvent, type AnyEvent } from "./events";
import { compareLogs, isPrefixOf } from "./replay";
import { defineSchema } from "./schema";

const schema = defineSchema({
  objects: { task: z.object({ title: z.string() }) },
  relations: {},
  events: {},
});
type S1 = typeof schema;

const ev = (id: number, type: string, payload: unknown) =>
  ({ id, branch: "main", type, payload, causedBy: null, at: "2026-01-01T00:00:00.000Z" }) as AnyEvent<S1>;

const recorded: AnyEvent<S1>[] = [
  ev(1, "goal.created", { goalId: "g1", text: "go" }),
  ev(2, "object.created", { objectId: "t1", objectType: "task", data: { title: "A" } }),
  ev(3, "runtime.idle", { processed: 2 }),
];

describe("compareLogs", () => {
  test("identical logs compare ok; prefixes compare ok", () => {
    expect(compareLogs(recorded, recorded).ok).toBe(true);
    expect(compareLogs(recorded, recorded.slice(0, 2)).ok).toBe(true);
    expect(isPrefixOf(recorded.slice(0, 2), recorded)).toBe(true);
  });

  test("the first payload difference is reported at its exact event id", () => {
    const diverged = [
      recorded[0] as AnyEvent<S1>,
      ev(2, "object.created", { objectId: "t1", objectType: "task", data: { title: "B" } }),
      recorded[2] as AnyEvent<S1>,
    ];
    const verdict = compareLogs(recorded, diverged);
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error.atEventId).toBe(2);
    expect(verdict.error.expected).toBe(canonicalEvent(recorded[1] as AnyEvent<S1>));
    expect(verdict.error.actual).toBe(canonicalEvent(diverged[1] as AnyEvent<S1>));
  });

  test("an actual log longer than the recording is a divergence, not a pass", () => {
    const longer = [...recorded, ev(4, "runtime.idle", { processed: 3 })];
    const verdict = compareLogs(recorded, longer);
    expect(verdict).toMatchObject({ ok: false, error: { atEventId: 4, expected: "" } });
    expect(isPrefixOf(longer, recorded)).toBe(false);
  });
});
