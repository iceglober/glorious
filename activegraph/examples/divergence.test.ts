import { describe, expect, test } from "bun:test";
import { canonicalJson } from "../domain/events";
import { describeDivergence } from "./divergence";

const canonical = (value: unknown) => canonicalJson(value);

describe("describeDivergence", () => {
  test("names the field that differs and shows both sides", () => {
    const lines = describeDivergence({
      atEventId: 16,
      expected: canonical({ id: 16, type: "approval.proposed", payload: { actor: "planner" } }),
      actual: canonical({ id: 16, type: "object.created", payload: { actor: "planner" } }),
    });

    expect(lines[0]).toBe("#16 diverged on type");
    expect(lines.join("\n")).toContain("recorded approval.proposed");
    expect(lines.join("\n")).toContain("derived  object.created");
    // The fields that match are not repeated back at the reader.
    expect(lines.join("\n")).not.toContain("payload");
  });

  test("reports every differing field, not just the first", () => {
    const lines = describeDivergence({
      atEventId: 4,
      expected: canonical({ id: 4, type: "runtime.idle", payload: { processed: 1 } }),
      actual: canonical({ id: 4, type: "runtime.idle", payload: { processed: 3 } }),
    });

    expect(lines[0]).toBe("#4 diverged on payload");
    expect(lines.join("\n")).toContain('recorded {"processed":1}');
    expect(lines.join("\n")).toContain('derived  {"processed":3}');
  });

  test("clips a long value rather than reprinting the whole payload", () => {
    const lines = describeDivergence({
      atEventId: 9,
      expected: canonical({ payload: { command: "x".repeat(400) } }),
      actual: canonical({ payload: { command: "y".repeat(400) } }),
    });

    expect(lines.join("\n")).toContain("…");
    for (const line of lines) expect(line.length).toBeLessThan(120);
  });

  test("says so plainly when the bytes differ but no field does", () => {
    const lines = describeDivergence({
      atEventId: 2,
      expected: "not json",
      actual: "also not json",
    });

    expect(lines).toEqual(["#2: the canonical bytes differ but no field does"]);
  });
});
