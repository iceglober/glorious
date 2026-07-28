/**
 * Clock adapters. The system clock is the only impure one; fixed and logical
 * clocks exist so tests and demos are deterministic by construction rather
 * than by freezing globals.
 */
import type { Clock } from "../ports/clock";

export const createSystemClock = (): Clock => ({
  now: () => new Date().toISOString(),
  monotonicSeconds: () => performance.now() / 1000,
});

/** Constant time: every event in a run carries the same stamp. */
export const createFixedClock = (at = "2026-01-01T00:00:00.000Z"): Clock => ({
  now: () => at,
  monotonicSeconds: () => 0,
});

/**
 * Deterministic advancing time: each `now()` call ticks forward. Useful when
 * a test wants distinguishable stamps without real time.
 */
export const createLogicalClock = (options?: {
  readonly startMs?: number;
  readonly tickSeconds?: number;
}): Clock => {
  const start = options?.startMs ?? Date.parse("2026-01-01T00:00:00.000Z");
  const tick = options?.tickSeconds ?? 1;
  let calls = 0;
  return {
    now: () => new Date(start + calls++ * tick * 1000).toISOString(),
    monotonicSeconds: () => calls * tick,
  };
};
