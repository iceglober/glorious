/**
 * TracerSink — a passive observer of appended events (console traces,
 * metrics, debugging). Sinks must not mutate anything the runtime reads;
 * they see events strictly in append order.
 */
import type { AnyEvent } from "../domain/events";
import type { SchemaDef } from "../domain/schema";

export interface TracerSink<S extends SchemaDef> {
  readonly onEvent: (event: AnyEvent<S>) => void;
}
