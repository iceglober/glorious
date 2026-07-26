/**
 * GraphStore — the materialized-projection seam. The runtime keeps its own
 * authoritative `GraphState` (derived from the log); a GraphStore mirrors it
 * so external backends (e.g. a native graph database) can serve queries.
 *
 * Contract: `apply(events)` must be observationally equal to folding
 * `applyEvent` over the same events — the shared contract test enforces this
 * for every adapter. `reset` rebases the mirror on a projected state
 * (startup, fork checkout).
 */
import type { AnyEvent } from "../domain/events";
import type { GraphState } from "../domain/graph";
import type { SchemaDef } from "../domain/schema";

export interface GraphStore<S extends SchemaDef> {
  readonly state: () => GraphState<S>;
  readonly apply: (events: readonly AnyEvent<S>[]) => void;
  readonly reset: (state: GraphState<S>) => void;
}
