import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  type AnyEvent,
  canonicalEvent,
  canonicalJson,
  canonicalLog,
  fnv1a64,
  hashRequest,
  isExternalEvent,
} from "./events";
import { defineSchema } from "./schema";

const schema = defineSchema({
  objects: { task: z.object({ title: z.string() }) },
  relations: {},
  events: { "task.completed": z.object({ taskId: z.string() }) },
});
type S1 = typeof schema;

const ev = (partial: {
  id: number;
  type: string;
  payload: unknown;
  causedBy?: number | null;
}): AnyEvent<S1> =>
  ({
    id: partial.id,
    branch: "main",
    type: partial.type,
    payload: partial.payload,
    causedBy: partial.causedBy ?? null,
    at: "2026-01-01T00:00:00.000Z",
  }) as AnyEvent<S1>;

describe("canonicalJson", () => {
  test("sorts object keys recursively and drops undefined members", () => {
    expect(canonicalJson({ b: 1, a: { d: undefined, c: [2, { z: 0, y: 1 }] } })).toBe(
      '{"a":{"c":[2,{"y":1,"z":0}]},"b":1}',
    );
  });

  test("is insensitive to key insertion order — the determinism property", () => {
    const one = canonicalJson({ x: 1, y: { a: true, b: null } });
    const two = canonicalJson({ y: { b: null, a: true }, x: 1 });
    expect(one).toBe(two);
  });

  test("handles primitives, null, and arrays", () => {
    expect(canonicalJson(null)).toBe("null");
    expect(canonicalJson("s")).toBe('"s"');
    expect(canonicalJson([1, "a", false])).toBe('[1,"a",false]');
  });
});

describe("canonicalEvent and canonicalLog", () => {
  test("two logs with identical events are byte-identical regardless of payload key order", () => {
    const a = ev({ id: 1, type: "task.completed", payload: { taskId: "t1" } });
    const b = ev({ id: 1, type: "task.completed", payload: { taskId: "t1" } });
    expect(canonicalEvent(a)).toBe(canonicalEvent(b));
    expect(canonicalLog([a])).toBe(canonicalLog([b]));
  });

  test("canonicalLog joins one canonical event per line", () => {
    const a = ev({ id: 1, type: "goal.created", payload: { goalId: "g1", text: "go" } });
    const b = ev({ id: 2, type: "runtime.idle", payload: { processed: 1 }, causedBy: null });
    expect(canonicalLog([a, b])).toBe(`${canonicalEvent(a)}\n${canonicalEvent(b)}`);
  });
});

describe("fnv1a64 and hashRequest", () => {
  test("is stable across calls and distinguishes different inputs", () => {
    expect(fnv1a64("abc")).toBe(fnv1a64("abc"));
    expect(fnv1a64("abc")).not.toBe(fnv1a64("abd"));
    expect(fnv1a64("abc")).toMatch(/^[0-9a-f]{16}$/);
  });

  test("hashRequest is key-order independent because it hashes canonical JSON", () => {
    expect(hashRequest({ prompt: "p", model: "m" })).toBe(hashRequest({ model: "m", prompt: "p" }));
  });
});

describe("isExternalEvent", () => {
  test("null-cause events are external unless they are runtime.idle or budget markers", () => {
    expect(
      isExternalEvent(ev({ id: 1, type: "goal.created", payload: { goalId: "g", text: "t" } })),
    ).toBe(true);
    expect(isExternalEvent(ev({ id: 2, type: "runtime.idle", payload: { processed: 0 } }))).toBe(
      false,
    );
    expect(
      isExternalEvent(
        ev({
          id: 3,
          type: "runtime.budget_exhausted",
          payload: { limit: "max_events", processed: 0 },
        }),
      ),
    ).toBe(false);
    expect(
      isExternalEvent(ev({ id: 4, type: "task.completed", payload: { taskId: "t" }, causedBy: 1 })),
    ).toBe(false);
  });
});
