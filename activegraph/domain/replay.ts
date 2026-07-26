/**
 * Divergence detection — the pure half of strict replay. Two logs agree iff
 * they agree byte-for-byte in canonical form, event by event; the first
 * mismatch (or a length difference) is the divergence. The shell's strict
 * replay re-runs behaviors against recorded stamps and calls this after each
 * settle; permissive replay never needs this module because it IS `project`.
 */
import { err, ok, type Result } from "../lib/fp";
import { canonicalEvent, type AnyEvent } from "./events";
import type { EventId, SchemaDef } from "./schema";

export interface Divergence {
  readonly atEventId: EventId;
  /** Canonical bytes; empty string when one side has no event at this position. */
  readonly expected: string;
  readonly actual: string;
}

/** Compare a full (or prefix) actual log against the recorded one. */
export const compareLogs = <S extends SchemaDef>(
  expected: readonly AnyEvent<S>[],
  actual: readonly AnyEvent<S>[],
): Result<void, Divergence> => {
  const length = Math.min(expected.length, actual.length);
  for (let i = 0; i < length; i++) {
    const want = expected[i];
    const got = actual[i];
    if (want === undefined || got === undefined) break;
    const wantBytes = canonicalEvent(want);
    const gotBytes = canonicalEvent(got);
    if (wantBytes !== gotBytes) {
      return err({ atEventId: want.id, expected: wantBytes, actual: gotBytes });
    }
  }
  if (actual.length > expected.length) {
    const extra = actual[expected.length];
    return err({
      atEventId: extra?.id ?? expected.length + 1,
      expected: "",
      actual: extra === undefined ? "" : canonicalEvent(extra),
    });
  }
  return ok(undefined);
};

/** True when `actual` is a byte-identical prefix of `expected` (mid-replay check). */
export const isPrefixOf = <S extends SchemaDef>(
  actual: readonly AnyEvent<S>[],
  expected: readonly AnyEvent<S>[],
): boolean => compareLogs(expected, actual).ok && actual.length <= expected.length;
