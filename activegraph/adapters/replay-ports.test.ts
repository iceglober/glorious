import { describe, expect, test } from "bun:test";
import { unwrap } from "../lib/fp";
import type { AnyEvent } from "../domain/events";
import { defineSchema } from "../domain/schema";
import { createRecordedStamps, createRecordedTools } from "./replay-ports";

const schema = defineSchema({ objects: {}, relations: {}, events: {} });
type S1 = typeof schema;

const ev = (id: number, type: string, payload: unknown, at: string): AnyEvent<S1> =>
  ({ id, branch: "main", type, payload, causedBy: null, at }) as AnyEvent<S1>;

describe("createRecordedStamps", () => {
  test("now() answers the stamp of the next event to be produced, driven by the tracer", () => {
    const recorded = [
      ev(1, "goal.created", { goalId: "g", text: "t" }, "2026-01-01T00:00:00.000Z"),
      ev(2, "runtime.idle", { processed: 1 }, "2026-01-01T00:00:05.000Z"),
    ];
    const { clock, tracer } = createRecordedStamps(recorded);
    expect(clock.now()).toBe("2026-01-01T00:00:00.000Z");
    expect(clock.monotonicSeconds()).toBe(0);
    tracer.onEvent(recorded[0] as AnyEvent<S1>);
    expect(clock.now()).toBe("2026-01-01T00:00:05.000Z");
    expect(clock.monotonicSeconds()).toBe(5);
    tracer.onEvent(recorded[1] as AnyEvent<S1>);
    // Past the end, the last stamp holds.
    expect(clock.now()).toBe("2026-01-01T00:00:05.000Z");
  });
});

describe("createRecordedTools", () => {
  test("replays outputs for matching (tool, input) pairs in order and errs on unknown demands", async () => {
    const at = "2026-01-01T00:00:00.000Z";
    const recorded = [
      ev(1, "tool.requested", { requestId: "r1", tool: "search", input: { q: "x" } }, at),
      ev(2, "tool.responded", { requestId: "r1", tool: "search", output: { hits: 1 }, isError: false }, at),
      ev(3, "tool.requested", { requestId: "r2", tool: "search", input: { q: "x" } }, at),
      ev(4, "tool.responded", { requestId: "r2", tool: "search", output: { hits: 2 }, isError: false }, at),
    ];
    const tools = createRecordedTools(recorded);
    expect(unwrap(await tools.execute("search", { q: "x" }))).toEqual({ hits: 1 });
    expect(unwrap(await tools.execute("search", { q: "x" }))).toEqual({ hits: 2 });
    expect(await tools.execute("search", { q: "x" })).toMatchObject({
      ok: false,
      error: { reason: "tool_error" },
    });
    expect(await tools.execute("other", {})).toMatchObject({ ok: false, error: { reason: "tool_error" } });
  });
});
