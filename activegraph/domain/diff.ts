/**
 * Structural graph diff, and its inverse-as-mutations — the pure half of
 * `promote`. `diffGraphs` compares two projections element-by-element;
 * `diffToMutations` turns the delta into ordinary proposals so a fork's
 * changes replay through the parent's normal validate/apply pipeline. That
 * pipeline is the conflict detector: `changedObjects` carry the fork's
 * `before` version as an optimistic `baseVersion`, so a parent that moved on
 * since the fork point rejects with `version_conflict` instead of silently
 * clobbering.
 */
import { canonicalJson } from "./events";
import type { GraphObject, GraphRelation, GraphState } from "./graph";
import { createMutations, type Mutation } from "./mutations";
import type { ObjectData, ObjectId, ObjectTypeName, SchemaDef } from "./schema";

export interface GraphDiff<S extends SchemaDef> {
  readonly addedObjects: readonly GraphObject<S>[];
  readonly removedObjects: readonly GraphObject<S>[];
  readonly changedObjects: readonly {
    readonly before: GraphObject<S>;
    readonly after: GraphObject<S>;
    /** Keys whose value changed, at their `after` values. */
    readonly patch: Record<string, unknown>;
  }[];
  readonly addedRelations: readonly GraphRelation<S>[];
  readonly removedRelations: readonly GraphRelation<S>[];
}

export const emptyDiff = <S extends SchemaDef>(diff: GraphDiff<S>): boolean =>
  diff.addedObjects.length === 0 &&
  diff.removedObjects.length === 0 &&
  diff.changedObjects.length === 0 &&
  diff.addedRelations.length === 0 &&
  diff.removedRelations.length === 0;

export const diffGraphs = <S extends SchemaDef>(
  base: GraphState<S>,
  head: GraphState<S>,
): GraphDiff<S> => {
  const addedObjects: GraphObject<S>[] = [];
  const changedObjects: GraphDiff<S>["changedObjects"][number][] = [];
  const removedObjects: GraphObject<S>[] = [];
  for (const [id, after] of head.objects) {
    const before = base.objects.get(id);
    if (before === undefined) {
      addedObjects.push(after);
      continue;
    }
    const beforeData = before.data as Record<string, unknown>;
    const afterData = after.data as Record<string, unknown>;
    const keys = new Set([...Object.keys(beforeData), ...Object.keys(afterData)]);
    const patch: Record<string, unknown> = {};
    for (const key of keys) {
      if (canonicalJson(beforeData[key]) !== canonicalJson(afterData[key])) {
        patch[key] = afterData[key];
      }
    }
    if (Object.keys(patch).length > 0) changedObjects.push({ before, after, patch });
  }
  for (const [id, before] of base.objects) {
    if (!head.objects.has(id)) removedObjects.push(before);
  }

  const addedRelations: GraphRelation<S>[] = [];
  const removedRelations: GraphRelation<S>[] = [];
  for (const [id, after] of head.relations) {
    if (!base.relations.has(id)) addedRelations.push(after);
  }
  for (const [id, before] of base.relations) {
    if (!head.relations.has(id)) removedRelations.push(before);
  }

  return { addedObjects, removedObjects, changedObjects, addedRelations, removedRelations };
};

/**
 * The delta as ordinary proposals, in a fixed order (removals first so a
 * remove-then-recreate delta lands cleanly): removed relations, removed
 * objects, added objects (keeping their fork ids so added relations can
 * reference them), changed objects (optimistic baseVersion = the fork's
 * `before` version), added relations.
 */
export const diffToMutations = <S extends SchemaDef>(
  schema: S,
  diff: GraphDiff<S>,
): readonly Mutation<S>[] => {
  const m = createMutations(schema);
  return [
    ...diff.removedRelations.map((relation) => m.removeRelation(relation.id)),
    ...diff.removedObjects.map((object) => m.removeObject(object.id)),
    ...diff.addedObjects.map((object) =>
      m.addObject(object.type, object.data, { id: object.id }),
    ),
    ...diff.changedObjects.map((change) =>
      m.patchObject(
        change.before.type,
        change.before.id as ObjectId<ObjectTypeName<S>>,
        change.patch as Partial<ObjectData<S, ObjectTypeName<S>>>,
        { baseVersion: change.before.version },
      ),
    ),
    ...diff.addedRelations.map((relation) =>
      m.addRelation(relation.type, relation.source, relation.target, { id: relation.id }),
    ),
  ];
};
