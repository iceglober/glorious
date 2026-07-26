import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type { AnyEvent } from "../domain/events";
import { project } from "../domain/graph";
import { defineSchema } from "../domain/schema";
import { createMemoryGraphStore } from "./memory-graph-store";

const schema = defineSchema({
  objects: { task: z.object({ title: z.string() }) },
  relations: {},
  events: {},
});
type S1 = typeof schema;

const ev = (id: number, type: string, payload: unknown): AnyEvent<S1> =>
  ({
    id,
    branch: "main",
    type,
    payload,
    causedBy: null,
    at: "2026-01-01T00:00:00.000Z",
  }) as AnyEvent<S1>;

const log = [
  ev(1, "object.created", { objectId: "t1", objectType: "task", data: { title: "A" } }),
  ev(2, "object.patched", {
    objectId: "t1",
    objectType: "task",
    patch: { title: "B" },
    baseVersion: 1,
    version: 2,
  }),
];

describe("createMemoryGraphStore", () => {
  test("apply equals folding applyEvent over the same events — the port contract", () => {
    const store = createMemoryGraphStore<S1>();
    store.apply(log.slice(0, 1));
    store.apply(log.slice(1));
    const direct = project<S1>(log);
    expect([...store.state().objects.entries()]).toEqual([...direct.objects.entries()]);
  });

  test("reset rebases the mirror on a projected state", () => {
    const store = createMemoryGraphStore<S1>();
    store.apply(log);
    store.reset(project<S1>(log.slice(0, 1)));
    expect(store.state().objects.get("t1")?.version).toBe(1);
  });
});
