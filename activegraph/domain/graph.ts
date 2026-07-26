/**
 * The graph projection — a pure fold of the event log.
 *
 * `applyEvent` is total: graph events (object/relation created, patched,
 * removed) transform the state, every other event is identity. `project` is
 * literally `fold(applyEvent, emptyGraph(), events)`; "permissive replay" IS
 * this function, which is what makes the log the single source of truth —
 * there is no way for graph state and log to disagree, because the graph is
 * derived and never stored authoritatively.
 *
 * Invariants:
 * - State is immutable: each applied event returns fresh maps; callers may
 *   hold old states (diff, fork baselines) safely.
 * - Removing an object cascades to its incident relations (documented,
 *   deterministic — the cascade is a function of the log, not extra events).
 * - `version` starts at 1 on create and is set verbatim from `object.patched`
 *   payloads, so projection never re-derives concurrency bookkeeping.
 * - `causedBy`/`updatedBy` carry provenance: the event ids that created and
 *   last touched each element.
 *
 * On the erased internal view: while `S` stays generic, `AnyEvent<S>` is an
 * unresolved indexed-access type, so TypeScript cannot narrow it by
 * discriminant — that narrowing only exists for callers holding a concrete
 * schema. The projection therefore switches over an erased shape and casts
 * the results back; the casts are confined to this module and the public
 * surface stays fully typed.
 */
import { fold } from "../lib/fp";
import type { AnyEvent } from "./events";
import type {
  EventId,
  ObjectData,
  ObjectId,
  ObjectTypeName,
  RelationId,
  RelationSource,
  RelationTarget,
  RelationTypeName,
  SchemaDef,
} from "./schema";

export interface GraphObject<S extends SchemaDef, T extends ObjectTypeName<S> = ObjectTypeName<S>> {
  readonly id: ObjectId<T>;
  readonly type: T;
  readonly data: ObjectData<S, T>;
  /** Bumped by each applied patch; the optimistic-concurrency token. */
  readonly version: number;
  /** The object.created event. */
  readonly causedBy: EventId;
  /** Last event touching this object. */
  readonly updatedBy: EventId;
}

export interface GraphRelation<
  S extends SchemaDef,
  R extends RelationTypeName<S> = RelationTypeName<S>,
> {
  readonly id: RelationId;
  readonly type: R;
  readonly source: ObjectId<RelationSource<S, R>>;
  readonly target: ObjectId<RelationTarget<S, R>>;
  readonly causedBy: EventId;
}

export interface GraphState<S extends SchemaDef> {
  readonly objects: ReadonlyMap<string, GraphObject<S>>;
  readonly relations: ReadonlyMap<string, GraphRelation<S>>;
}

export const emptyGraph = <S extends SchemaDef>(): GraphState<S> => ({
  objects: new Map(),
  relations: new Map(),
});

/** Erased event view for generic library internals; see module header. */
interface ErasedEvent {
  readonly id: EventId;
  readonly type: string;
  readonly payload: {
    readonly objectId?: string;
    readonly objectType?: string;
    readonly data?: Record<string, unknown>;
    readonly patch?: Record<string, unknown>;
    readonly version?: number;
    readonly relationId?: string;
    readonly relationType?: string;
    readonly source?: string;
    readonly target?: string;
  };
}

/** THE projection step: pure, total. Non-graph events are identity. */
export const applyEvent = <S extends SchemaDef>(
  state: GraphState<S>,
  event: AnyEvent<S>,
): GraphState<S> => {
  const e = event as unknown as ErasedEvent;
  switch (e.type) {
    case "object.created": {
      const objects = new Map(state.objects);
      const created = {
        id: e.payload.objectId,
        type: e.payload.objectType,
        data: e.payload.data,
        version: 1,
        causedBy: e.id,
        updatedBy: e.id,
      } as unknown as GraphObject<S>;
      objects.set(created.id, created);
      return { objects, relations: state.relations };
    }
    case "object.patched": {
      const id = e.payload.objectId as string;
      const existing = state.objects.get(id);
      if (existing === undefined) return state;
      const objects = new Map(state.objects);
      const patched = {
        ...existing,
        data: { ...(existing.data as Record<string, unknown>), ...e.payload.patch },
        version: e.payload.version ?? existing.version + 1,
        updatedBy: e.id,
      } as GraphObject<S>;
      objects.set(id, patched);
      return { objects, relations: state.relations };
    }
    case "object.removed": {
      const id = e.payload.objectId as string;
      if (!state.objects.has(id)) return state;
      const objects = new Map(state.objects);
      objects.delete(id);
      const relations = new Map(state.relations);
      for (const [relId, relation] of state.relations) {
        if (relation.source === id || relation.target === id) relations.delete(relId);
      }
      return { objects, relations };
    }
    case "relation.created": {
      const relations = new Map(state.relations);
      const created = {
        id: e.payload.relationId,
        type: e.payload.relationType,
        source: e.payload.source,
        target: e.payload.target,
        causedBy: e.id,
      } as unknown as GraphRelation<S>;
      relations.set(created.id, created);
      return { objects: state.objects, relations };
    }
    case "relation.removed": {
      const id = e.payload.relationId as string;
      if (!state.relations.has(id)) return state;
      const relations = new Map(state.relations);
      relations.delete(id);
      return { objects: state.objects, relations };
    }
    default:
      return state;
  }
};

/** project = fold(applyEvent, emptyGraph(), events). Permissive replay IS this function. */
export const project = <S extends SchemaDef>(events: Iterable<AnyEvent<S>>): GraphState<S> =>
  fold(applyEvent, emptyGraph<S>(), events);
