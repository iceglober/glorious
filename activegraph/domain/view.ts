/**
 * Scoped, typed reads over an immutable graph snapshot plus the log tail —
 * what a behavior is allowed to see. Views are closures over frozen inputs,
 * so they are pure values: two views over the same state answer identically,
 * which is one leg of the replay determinism contract.
 *
 * `objects("task")` returns `GraphObject<S, "task">[]` — the type parameter
 * flows from the schema, so `.data` is the zod-inferred shape, no casts.
 * `provenance` walks the `causedBy` chain from an object's creating event
 * back to the external input that ultimately caused it.
 */
import type { AnyEvent } from "./events";
import type { GraphObject, GraphRelation, GraphState } from "./graph";
import type { EventId, ObjectId, ObjectTypeName, RelationTypeName, SchemaDef } from "./schema";

export interface GraphView<S extends SchemaDef> {
  readonly object: <T extends ObjectTypeName<S>>(id: ObjectId<T>) => GraphObject<S, T> | undefined;
  readonly objects: <T extends ObjectTypeName<S>>(type: T) => readonly GraphObject<S, T>[];
  readonly relations: <R extends RelationTypeName<S>>(type: R) => readonly GraphRelation<S, R>[];
  readonly relationsOf: (id: ObjectId<ObjectTypeName<S>>) => readonly GraphRelation<S>[];
  readonly recentEvents: (limit?: number) => readonly AnyEvent<S>[];
  /** The causedBy chain of the event that created the element, oldest first. */
  readonly provenance: (id: ObjectId<ObjectTypeName<S>>) => readonly AnyEvent<S>[];
}

export const createGraphView = <S extends SchemaDef>(options: {
  readonly state: GraphState<S>;
  readonly log: readonly AnyEvent<S>[];
}): GraphView<S> => {
  const { state, log } = options;
  const eventById = (id: EventId): AnyEvent<S> | undefined => log.find((event) => event.id === id);
  return {
    object: <T extends ObjectTypeName<S>>(id: ObjectId<T>) =>
      state.objects.get(id) as GraphObject<S, T> | undefined,
    objects: (type) =>
      [...state.objects.values()].filter(
        (object): object is GraphObject<S, typeof type> => object.type === type,
      ),
    relations: (type) =>
      [...state.relations.values()].filter(
        (relation): relation is GraphRelation<S, typeof type> => relation.type === type,
      ),
    relationsOf: (id) =>
      [...state.relations.values()].filter(
        (relation) => relation.source === id || relation.target === id,
      ),
    recentEvents: (limit = 20) => log.slice(Math.max(0, log.length - limit)),
    provenance: (id) => {
      const element = state.objects.get(id);
      if (element === undefined) return [];
      const chain: AnyEvent<S>[] = [];
      let cursor: EventId | null = element.causedBy;
      while (cursor !== null) {
        const event = eventById(cursor);
        if (event === undefined) break;
        chain.push(event);
        cursor = event.causedBy;
      }
      return chain.reverse();
    },
  };
};
