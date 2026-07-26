/**
 * Mutations — typed, inert proposals. This is the FP inversion of the Python
 * original: where Python behaviors imperatively call `graph.add_object(...)`,
 * behaviors here RETURN `Mutation<S>` values and the runtime decides. Nothing
 * in this module touches state; `validateMutation` is a pure judgment of one
 * proposal against a graph snapshot, and rejections are data (tagged
 * `RejectionReason`), destined to become `patch.rejected` events — never
 * exceptions.
 *
 * The compile-time types make ill-formed proposals unrepresentable for
 * callers with a concrete schema (wrong data shape, wrong endpoint id brand,
 * unknown event name). Validation still re-checks everything at runtime —
 * zod-parsing data, comparing optimistic `baseVersion` tokens, checking
 * relation endpoint object types — because ids and payloads can cross
 * serialization boundaries (stores, forks, promote) where brands are fiction.
 *
 * Same erasure note as `graph.ts`: generic internals switch over an erased
 * mutation shape because `Mutation<S>` only narrows for concrete schemas.
 */
import { err, ok, type Result } from "../lib/fp";
import type { EventMap } from "./events";
import type { GraphState } from "./graph";
import type {
  CustomEventName,
  ObjectData,
  ObjectId,
  ObjectTypeName,
  RelationId,
  RelationSource,
  RelationTarget,
  RelationTypeName,
  SchemaDef,
} from "./schema";

export type Mutation<S extends SchemaDef> =
  | {
      [T in ObjectTypeName<S>]: {
        readonly kind: "addObject";
        readonly objectType: T;
        readonly data: ObjectData<S, T>;
        readonly id?: ObjectId<T>;
        readonly requiresApproval?: true;
      };
    }[ObjectTypeName<S>]
  | {
      [T in ObjectTypeName<S>]: {
        readonly kind: "patchObject";
        readonly objectType: T;
        readonly objectId: ObjectId<T>;
        readonly patch: Partial<ObjectData<S, T>>;
        /** Optimistic concurrency token; omitted = last-write-wins against current version. */
        readonly baseVersion?: number;
        readonly requiresApproval?: true;
      };
    }[ObjectTypeName<S>]
  | {
      readonly kind: "removeObject";
      readonly objectId: ObjectId<ObjectTypeName<S>>;
      readonly requiresApproval?: true;
    }
  | {
      [R in RelationTypeName<S>]: {
        readonly kind: "addRelation";
        readonly relationType: R;
        readonly source: ObjectId<RelationSource<S, R>>;
        readonly target: ObjectId<RelationTarget<S, R>>;
        readonly id?: RelationId;
        readonly requiresApproval?: true;
      };
    }[RelationTypeName<S>]
  | {
      readonly kind: "removeRelation";
      readonly relationId: RelationId;
      readonly requiresApproval?: true;
    }
  | {
      [K in CustomEventName<S>]: {
        readonly kind: "emit";
        readonly type: K;
        readonly payload: EventMap<S>[K];
      };
    }[CustomEventName<S>];

/** JSON-serializable erased form of a mutation, for embedding in event payloads. */
export type MutationSnapshot = { readonly kind: string } & Record<string, unknown>;

export const toSnapshot = <S extends SchemaDef>(mutation: Mutation<S>): MutationSnapshot =>
  mutation as unknown as MutationSnapshot;

/** Value constructors handed to behaviors as `ctx.m`. All typed, zero casts at call sites. */
export interface MutationBuilder<S extends SchemaDef> {
  readonly addObject: <T extends ObjectTypeName<S>>(
    type: T,
    data: ObjectData<S, T>,
    options?: { readonly id?: ObjectId<NoInfer<T>>; readonly requiresApproval?: true },
  ) => Mutation<S>;
  readonly patchObject: <T extends ObjectTypeName<S>>(
    type: T,
    // NoInfer: only the `type` argument may pick T — otherwise a mismatched id
    // would widen T to a union instead of failing to compile.
    id: ObjectId<NoInfer<T>>,
    patch: Partial<ObjectData<S, NoInfer<T>>>,
    options?: { readonly baseVersion?: number; readonly requiresApproval?: true },
  ) => Mutation<S>;
  readonly removeObject: (
    id: ObjectId<ObjectTypeName<S>>,
    options?: { readonly requiresApproval?: true },
  ) => Mutation<S>;
  readonly addRelation: <R extends RelationTypeName<S>>(
    type: R,
    source: ObjectId<RelationSource<S, R>>,
    target: ObjectId<RelationTarget<S, R>>,
    options?: { readonly id?: RelationId; readonly requiresApproval?: true },
  ) => Mutation<S>;
  readonly removeRelation: (
    id: RelationId,
    options?: { readonly requiresApproval?: true },
  ) => Mutation<S>;
  readonly emit: <K extends CustomEventName<S>>(type: K, payload: EventMap<S>[K]) => Mutation<S>;
}

/** The schema parameter exists purely to infer S; constructors are inert taggers. */
export const createMutations = <S extends SchemaDef>(_schema: S): MutationBuilder<S> => ({
  addObject: (type, data, options) =>
    ({
      kind: "addObject",
      objectType: type,
      data,
      ...(options?.id !== undefined ? { id: options.id } : {}),
      ...(options?.requiresApproval ? { requiresApproval: true as const } : {}),
    }) as Mutation<S>,
  patchObject: (type, id, patch, options) =>
    ({
      kind: "patchObject",
      objectType: type,
      objectId: id,
      patch,
      ...(options?.baseVersion !== undefined ? { baseVersion: options.baseVersion } : {}),
      ...(options?.requiresApproval ? { requiresApproval: true as const } : {}),
    }) as Mutation<S>,
  removeObject: (id, options) =>
    ({
      kind: "removeObject",
      objectId: id,
      ...(options?.requiresApproval ? { requiresApproval: true as const } : {}),
    }) as Mutation<S>,
  addRelation: (type, source, target, options) =>
    ({
      kind: "addRelation",
      relationType: type,
      source,
      target,
      ...(options?.id !== undefined ? { id: options.id } : {}),
      ...(options?.requiresApproval ? { requiresApproval: true as const } : {}),
    }) as Mutation<S>,
  removeRelation: (id, options) =>
    ({
      kind: "removeRelation",
      relationId: id,
      ...(options?.requiresApproval ? { requiresApproval: true as const } : {}),
    }) as Mutation<S>,
  emit: (type, payload) => ({ kind: "emit", type, payload }) as Mutation<S>,
});

export type RejectionReason =
  | { readonly reason: "version_conflict"; readonly expected: number; readonly actual: number }
  | { readonly reason: "unknown_object"; readonly objectId: string }
  | { readonly reason: "duplicate_id"; readonly objectId: string }
  | { readonly reason: "schema_invalid"; readonly issues: readonly string[] }
  | {
      readonly reason: "endpoint_type_mismatch";
      readonly relationType: string;
      readonly expected: string;
      readonly actual: string;
      readonly end: "source" | "target";
    }
  | { readonly reason: "unknown_relation"; readonly relationId: string };

/** Erased mutation view for generic internals; see module header. */
interface ErasedMutation {
  readonly kind: string;
  readonly objectType?: string;
  readonly objectId?: string;
  readonly id?: string;
  readonly data?: Record<string, unknown>;
  readonly patch?: Record<string, unknown>;
  readonly baseVersion?: number;
  readonly relationType?: string;
  readonly relationId?: string;
  readonly source?: string;
  readonly target?: string;
  readonly type?: string;
  readonly payload?: unknown;
  readonly requiresApproval?: true;
}

const zodIssues = (result: { readonly error?: { readonly issues: readonly unknown[] } }) =>
  (result.error?.issues ?? []).map((issue) => {
    const i = issue as { readonly path?: readonly PropertyKey[]; readonly message?: string };
    const path = (i.path ?? []).join(".");
    return path === "" ? (i.message ?? "invalid") : `${path}: ${i.message ?? "invalid"}`;
  });

/**
 * Pure validation of one proposal against current graph state. Compile-time
 * types keep honest callers safe; this re-checks at runtime because ids and
 * payloads can cross serialization boundaries.
 */
export const validateMutation = <S extends SchemaDef>(options: {
  readonly schema: S;
  readonly graph: GraphState<S>;
  readonly mutation: Mutation<S>;
}): Result<void, RejectionReason> => {
  const { schema, graph } = options;
  const m = options.mutation as unknown as ErasedMutation;
  switch (m.kind) {
    case "addObject": {
      const objectSchema = schema.objects[m.objectType ?? ""];
      if (objectSchema === undefined) {
        return err({ reason: "schema_invalid", issues: [`unknown object type ${m.objectType}`] });
      }
      const parsed = objectSchema.safeParse(m.data);
      if (!parsed.success) return err({ reason: "schema_invalid", issues: zodIssues(parsed) });
      if (m.id !== undefined && graph.objects.has(m.id)) {
        return err({ reason: "duplicate_id", objectId: m.id });
      }
      return ok(undefined);
    }
    case "patchObject": {
      const id = m.objectId ?? "";
      const existing = graph.objects.get(id);
      if (existing === undefined) return err({ reason: "unknown_object", objectId: id });
      if (m.objectType !== undefined && existing.type !== m.objectType) {
        return err({
          reason: "schema_invalid",
          issues: [`object ${id} has type ${existing.type}, not ${m.objectType}`],
        });
      }
      if (m.baseVersion !== undefined && m.baseVersion !== existing.version) {
        return err({
          reason: "version_conflict",
          expected: m.baseVersion,
          actual: existing.version,
        });
      }
      const objectSchema = schema.objects[existing.type];
      if (objectSchema === undefined) {
        return err({ reason: "schema_invalid", issues: [`unknown object type ${existing.type}`] });
      }
      const merged = { ...(existing.data as Record<string, unknown>), ...m.patch };
      const parsed = objectSchema.safeParse(merged);
      if (!parsed.success) return err({ reason: "schema_invalid", issues: zodIssues(parsed) });
      return ok(undefined);
    }
    case "removeObject": {
      const id = m.objectId ?? "";
      if (!graph.objects.has(id)) return err({ reason: "unknown_object", objectId: id });
      return ok(undefined);
    }
    case "addRelation": {
      const ends = schema.relations[m.relationType ?? ""];
      if (ends === undefined) {
        return err({
          reason: "schema_invalid",
          issues: [`unknown relation type ${m.relationType}`],
        });
      }
      const source = graph.objects.get(m.source ?? "");
      if (source === undefined) return err({ reason: "unknown_object", objectId: m.source ?? "" });
      const target = graph.objects.get(m.target ?? "");
      if (target === undefined) return err({ reason: "unknown_object", objectId: m.target ?? "" });
      if (source.type !== ends.source) {
        return err({
          reason: "endpoint_type_mismatch",
          relationType: m.relationType ?? "",
          expected: ends.source,
          actual: source.type,
          end: "source",
        });
      }
      if (target.type !== ends.target) {
        return err({
          reason: "endpoint_type_mismatch",
          relationType: m.relationType ?? "",
          expected: ends.target,
          actual: target.type,
          end: "target",
        });
      }
      return ok(undefined);
    }
    case "removeRelation": {
      const id = m.relationId ?? "";
      if (!graph.relations.has(id)) return err({ reason: "unknown_relation", relationId: id });
      return ok(undefined);
    }
    case "emit": {
      const eventSchema = schema.events[m.type ?? ""];
      if (eventSchema === undefined) {
        return err({ reason: "schema_invalid", issues: [`unknown custom event ${m.type}`] });
      }
      const parsed = eventSchema.safeParse(m.payload);
      if (!parsed.success) return err({ reason: "schema_invalid", issues: zodIssues(parsed) });
      return ok(undefined);
    }
    default:
      return err({ reason: "schema_invalid", issues: [`unknown mutation kind ${m.kind}`] });
  }
};
