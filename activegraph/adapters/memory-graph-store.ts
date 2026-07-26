/**
 * In-memory GraphStore — mirrors the projection by folding the same pure
 * `applyEvent` the runtime uses, so it satisfies the port contract by
 * construction.
 */
import { fold } from "../lib/fp";
import type { AnyEvent } from "../domain/events";
import { applyEvent, emptyGraph, type GraphState } from "../domain/graph";
import type { SchemaDef } from "../domain/schema";
import type { GraphStore } from "../ports/graph-store";

export const createMemoryGraphStore = <S extends SchemaDef>(): GraphStore<S> => {
  let state: GraphState<S> = emptyGraph();
  return {
    state: () => state,
    apply: (events: readonly AnyEvent<S>[]) => {
      state = fold(applyEvent, state, events);
    },
    reset: (next) => {
      state = next;
    },
  };
};
