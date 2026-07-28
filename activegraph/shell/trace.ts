/**
 * Trace formatting — the human-readable face of the log. `formatEvent` and
 * `formatTrace` are pure (usable anywhere); `createConsoleTracer` is the one
 * impure convenience, a TracerSink that writes each event as it is appended.
 */
import { type AnyEvent, canonicalJson } from "../domain/events";
import type { SchemaDef } from "../domain/schema";
import type { TracerSink } from "../ports/tracer";

const summarize = (payload: unknown): string => {
  const body = canonicalJson(payload);
  return body.length <= 120 ? body : `${body.slice(0, 117)}...`;
};

export const formatEvent = <S extends SchemaDef>(event: AnyEvent<S>): string => {
  const cause = event.causedBy === null ? "external" : `caused by #${event.causedBy}`;
  return `#${event.id} ${event.type} ${summarize(event.payload)} (${cause})`;
};

export const formatTrace = <S extends SchemaDef>(log: Iterable<AnyEvent<S>>): string => {
  const lines: string[] = [];
  for (const event of log) lines.push(formatEvent(event));
  return lines.join("\n");
};

export const createConsoleTracer = <S extends SchemaDef>(
  write: (line: string) => void = console.log,
): TracerSink<S> => ({
  onEvent: (event) => {
    write(formatEvent(event));
  },
});
