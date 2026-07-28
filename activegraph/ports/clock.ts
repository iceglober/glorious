/**
 * Clock — the only source of time. The domain never samples time; the shell
 * samples this port once per step and threads the stamp through the pure
 * functions. Determinism in tests and replay comes from swapping this port
 * (fixed, logical, or recorded clocks), never from freezing globals.
 */
export interface Clock {
  /** ISO-8601 timestamp for event stamps. */
  readonly now: () => string;
  /** Monotonic seconds for budget accounting; unrelated to wall time. */
  readonly monotonicSeconds: () => number;
}
