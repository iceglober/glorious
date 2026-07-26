import { describe, expect, test } from "bun:test";
import { createFixedClock, createLogicalClock, createSystemClock } from "./clocks";

describe("clock adapters", () => {
  test("fixed clock always answers the same stamp and zero elapsed", () => {
    const clock = createFixedClock("2026-02-02T00:00:00.000Z");
    expect(clock.now()).toBe("2026-02-02T00:00:00.000Z");
    expect(clock.now()).toBe(clock.now());
    expect(clock.monotonicSeconds()).toBe(0);
  });

  test("logical clock ticks deterministically per call", () => {
    const clock = createLogicalClock({
      startMs: Date.parse("2026-01-01T00:00:00.000Z"),
      tickSeconds: 2,
    });
    expect(clock.now()).toBe("2026-01-01T00:00:00.000Z");
    expect(clock.now()).toBe("2026-01-01T00:00:02.000Z");
    expect(clock.monotonicSeconds()).toBe(4);
  });

  test("system clock produces parseable ISO stamps and non-negative monotonic seconds", () => {
    const clock = createSystemClock();
    expect(Number.isNaN(Date.parse(clock.now()))).toBe(false);
    expect(clock.monotonicSeconds()).toBeGreaterThanOrEqual(0);
  });
});
