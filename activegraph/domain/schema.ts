/**
 * The generic foundation everything threads through. One `defineSchema` call
 * fixes the vocabulary — object types (zod-schema'd data), relation types
 * (endpoints constrained to declared object types), and custom event types —
 * and every other module derives its types from that single `S extends
 * SchemaDef` parameter. This is what makes the port "type-safe": the Python
 * original's stringly-typed `add_object("task", {...})` becomes a call whose
 * data shape, id brand, and relation endpoints are all checked at compile time.
 *
 * Ids are branded BY OBJECT TYPE (`ObjectId<"task">`), so passing a note id
 * where a relation demands a task endpoint is a compile error, not a runtime
 * surprise. Event ids are per-branch contiguous sequence numbers — the
 * currency of provenance, forking, and replay.
 */
import type z from "zod";
import type { Brand } from "../lib/fp";

/** Endpoint declaration for a relation type; endpoints name object types in the same schema. */
export interface RelationEnds<ObjectType extends string = string> {
  readonly source: ObjectType;
  readonly target: ObjectType;
}

/** The widest schema shape; concrete schemas are subtypes with literal keys preserved. */
export interface SchemaDef {
  readonly objects: Record<string, z.ZodType>;
  readonly relations: Record<string, RelationEnds>;
  readonly events: Record<string, z.ZodType>;
}

/**
 * Identity builder (the repo's `defineTool` idiom). `const` type parameters
 * preserve literal keys; the R constraint referencing O forces relation
 * endpoints to name declared object types — a typo in `source` is a compile
 * error.
 */
export const defineSchema = <
  const O extends Record<string, z.ZodType>,
  const R extends Record<string, RelationEnds<keyof O & string>>,
  const E extends Record<string, z.ZodType>,
>(schema: {
  readonly objects: O;
  readonly relations: R;
  readonly events: E;
}): { readonly objects: O; readonly relations: R; readonly events: E } => schema;

// Derived type utilities — the vocabulary every other module speaks.
export type ObjectTypeName<S extends SchemaDef> = keyof S["objects"] & string;
export type ObjectData<S extends SchemaDef, T extends ObjectTypeName<S>> = z.infer<
  S["objects"][T]
>;
export type RelationTypeName<S extends SchemaDef> = keyof S["relations"] & string;
export type RelationSource<
  S extends SchemaDef,
  R extends RelationTypeName<S>,
> = S["relations"][R]["source"] & ObjectTypeName<S>;
export type RelationTarget<
  S extends SchemaDef,
  R extends RelationTypeName<S>,
> = S["relations"][R]["target"] & ObjectTypeName<S>;
export type CustomEventName<S extends SchemaDef> = keyof S["events"] & string;

/** Object ids are branded by object type, so relation endpoints type-check at compile time. */
export type ObjectId<T extends string = string> = Brand<string, "ObjectId"> & {
  readonly __objectType: T;
};
export type RelationId = Brand<string, "RelationId">;
/** Per-branch monotonic, contiguous sequence number starting at 1. */
export type EventId = number;

/** Runtime constructor for branded object ids — the brand is purely a compile-time fiction. */
export const objectId = <T extends string>(id: string): ObjectId<T> => id as ObjectId<T>;
export const relationId = (id: string): RelationId => id as RelationId;
