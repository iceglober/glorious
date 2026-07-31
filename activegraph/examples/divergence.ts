/**
 * Making a divergence readable.
 *
 * `replayStrict` reports the first differing event as two canonical JSON
 * strings, which is the right currency for deciding *whether* a log
 * re-derives and a poor one for seeing *why*: the strings are long, key-sorted,
 * and usually identical apart from one field. This names the fields that
 * actually differ.
 */

const parse = (canonical: string): Record<string, unknown> => {
  try {
    return JSON.parse(canonical) as Record<string, unknown>;
  } catch {
    return {};
  }
};

const clip = (value: unknown, limit = 90): string => {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return "undefined";
  return text.length <= limit ? text : `${text.slice(0, limit)}…`;
};

export interface Divergence {
  readonly atEventId: number;
  readonly expected: string;
  readonly actual: string;
}

/**
 * Lines naming each field where the recording and the re-derivation differ.
 * "recorded" is what the log says; "derived" is what today's behaviors produce.
 */
export const describeDivergence = (divergence: Divergence): readonly string[] => {
  const recorded = parse(divergence.expected);
  const derived = parse(divergence.actual);
  const fields = [...new Set([...Object.keys(recorded), ...Object.keys(derived)])].sort();

  const differing = fields.filter(
    (field) => JSON.stringify(recorded[field]) !== JSON.stringify(derived[field]),
  );
  if (differing.length === 0) {
    return [`#${divergence.atEventId}: the canonical bytes differ but no field does`];
  }
  return [
    `#${divergence.atEventId} diverged on ${differing.join(", ")}`,
    ...differing.flatMap((field) => [
      `  ${field}:`,
      `    recorded ${clip(recorded[field])}`,
      `    derived  ${clip(derived[field])}`,
    ]),
  ];
};
