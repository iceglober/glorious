import { describe, expect, test } from "bun:test";
import type { AnyEvent } from "../domain/events";
import { defineSchema } from "../domain/schema";
import { createConsoleTracer, formatEvent, formatTrace } from "./trace";

const schema = defineSchema({ objects: {}, relations: {}, events: {} });
type S1 = typeof schema;

const ev = (id: number, type: string, payload: unknown, causedBy: number | null): AnyEvent<S1> =>
  ({ id, branch: "main", type, payload, causedBy, at: "2026-01-01T00:00:00.000Z" }) as AnyEvent<S1>;

describe("trace formatting", () => {
  test("formatEvent shows id, type, canonical payload, and provenance", () => {
    expect(formatEvent(ev(1, "goal.created", { goalId: "g", text: "go" }, null))).toBe(
      '#1 goal.created {"goalId":"g","text":"go"} (external)',
    );
    expect(formatEvent(ev(7, "runtime.idle", { processed: 6 }, null))).toContain("(external)");
    expect(formatEvent(ev(3, "behavior.started", { behavior: "b", forEvent: 1 }, 1))).toContain(
      "(caused by #1)",
    );
  });

  test("long payloads are truncated with an ellipsis", () => {
    const line = formatEvent(ev(1, "goal.created", { goalId: "g", text: "x".repeat(500) }, null));
    expect(line).toContain("...");
    expect(line.length).toBeLessThan(200);
  });

  test("formatTrace joins one line per event; the console tracer writes them", () => {
    const events = [
      ev(1, "goal.created", { goalId: "g", text: "t" }, null),
      ev(2, "runtime.idle", { processed: 1 }, null),
    ];
    expect(formatTrace(events).split("\n")).toHaveLength(2);

    const lines: string[] = [];
    const tracer = createConsoleTracer<S1>((line) => lines.push(line));
    for (const event of events) tracer.onEvent(event);
    expect(lines).toEqual(events.map(formatEvent));
  });
});
