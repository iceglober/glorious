/**
 * The event vocabulary and its canonical byte form — the heart of the
 * determinism contract.
 *
 * `BuiltinEventMap<S>` is the fixed lifecycle vocabulary of the Python
 * original; payloads that reference objects DISTRIBUTE over the schema's
 * object types, so `payload.objectType === "task"` narrows `payload.data` to
 * the task shape. `EventMap<S>` is built-ins ∪ the schema's custom events, and
 * `AnyEvent<S>` distributes over event names into a discriminated union —
 * `switch (event.type)` narrows the payload with no casts.
 *
 * `canonicalEvent` (recursively key-sorted JSON) is THE currency of the
 * determinism contract: two runs are identical iff their canonical logs are
 * byte-identical, replay divergence is the first canonical mismatch, and the
 * LLM cache key is the FNV-1a hash of a canonical request. Every event is
 * stamped `causedBy` — the id of the event whose dispatch produced it (null
 * for external inputs) — which is the provenance chain.
 */
import type z from "zod";
import type { TraceEntry } from "./effects";
import type { MutationSnapshot, RejectionReason } from "./mutations";
import type {
  CustomEventName,
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

export type BuiltinEventMap<S extends SchemaDef> = {
  readonly "goal.created": { readonly goalId: string; readonly text: string };
  readonly "object.created": {
    [T in ObjectTypeName<S>]: {
      readonly objectId: ObjectId<T>;
      readonly objectType: T;
      readonly data: ObjectData<S, T>;
    };
  }[ObjectTypeName<S>];
  readonly "object.patched": {
    [T in ObjectTypeName<S>]: {
      readonly objectId: ObjectId<T>;
      readonly objectType: T;
      readonly patch: Partial<ObjectData<S, T>>;
      /** Version the patch was applied against. */
      readonly baseVersion: number;
      /** Version after application — `applyEvent` sets it verbatim. */
      readonly version: number;
    };
  }[ObjectTypeName<S>];
  readonly "object.removed": {
    readonly objectId: ObjectId<ObjectTypeName<S>>;
    readonly objectType: ObjectTypeName<S>;
  };
  readonly "relation.created": {
    [R in RelationTypeName<S>]: {
      readonly relationId: RelationId;
      readonly relationType: R;
      readonly source: ObjectId<RelationSource<S, R>>;
      readonly target: ObjectId<RelationTarget<S, R>>;
    };
  }[RelationTypeName<S>];
  readonly "relation.removed": {
    readonly relationId: RelationId;
    readonly relationType: RelationTypeName<S>;
  };
  readonly "behavior.scheduled": { readonly behavior: string; readonly forEvent: EventId };
  readonly "behavior.started": { readonly behavior: string; readonly forEvent: EventId };
  readonly "behavior.completed": {
    readonly behavior: string;
    readonly forEvent: EventId;
    readonly mutations: number;
  };
  readonly "behavior.failed": {
    readonly behavior: string;
    readonly forEvent: EventId;
    readonly reason: string;
  };
  readonly "patch.proposed": {
    readonly actor: string;
    readonly mutation: MutationSnapshot;
  };
  readonly "patch.applied": {
    readonly actor: string;
    readonly mutation: MutationSnapshot;
  };
  readonly "patch.rejected": {
    readonly actor: string;
    readonly mutation: MutationSnapshot;
    readonly rejection: RejectionReason;
  };
  readonly "llm.requested": {
    readonly requestId: string;
    readonly requestHash: string;
    readonly request: unknown;
  };
  readonly "llm.responded": {
    readonly requestId: string;
    readonly requestHash: string;
    readonly response: { readonly text: string };
    readonly cached: boolean;
  };
  readonly "tool.requested": {
    readonly requestId: string;
    readonly tool: string;
    readonly input: unknown;
  };
  readonly "tool.responded": {
    readonly requestId: string;
    readonly tool: string;
    readonly output: unknown;
    readonly isError: boolean;
  };
  readonly "approval.proposed": {
    readonly approvalId: string;
    readonly actor: string;
    readonly mutation: MutationSnapshot;
  };
  readonly "approval.granted": { readonly approvalId: string };
  readonly "runtime.idle": { readonly processed: number };
  readonly "runtime.budget_exhausted": {
    readonly limit: "max_events" | "max_seconds";
    readonly processed: number;
  };
};

/** Full event map: built-ins ∪ custom events declared in the schema. */
export type EventMap<S extends SchemaDef> = BuiltinEventMap<S> & {
  readonly [K in CustomEventName<S>]: z.infer<S["events"][K]>;
};
export type EventName<S extends SchemaDef> = keyof EventMap<S> & string;

export interface EventOf<S extends SchemaDef, K extends EventName<S>> {
  /** Contiguous per branch, starting at 1. */
  readonly id: EventId;
  /** "main" or a fork name. */
  readonly branch: string;
  readonly type: K;
  readonly payload: EventMap<S>[K];
  /** Id of the event whose dispatch produced this one; null for external inputs. */
  readonly causedBy: EventId | null;
  /** ISO-8601 timestamp from the injected Clock — never sampled by the domain. */
  readonly at: string;
}

/**
 * Distribute a union of event names into a union of concrete events. This is
 * what behavior handlers receive: `EventUnion<S, "a" | "b">` is
 * `EventOf<S, "a"> | EventOf<S, "b">` — a discriminated union that narrows by
 * `event.type` — NOT the single object type `EventOf<S, "a" | "b">`, whose
 * `type` and `payload` unions would be uncorrelated.
 */
export type EventUnion<S extends SchemaDef, K extends EventName<S>> = {
  [P in K]: EventOf<S, P>;
}[K];

/** Every event the runtime can carry — `switch (event.type)` narrows payload. */
export type AnyEvent<S extends SchemaDef> = EventUnion<S, EventName<S>>;

/** Built-in event types that are never external inputs even though `causedBy` is null. */
export const DERIVED_NULL_CAUSE_TYPES: readonly string[] = [
  "runtime.idle",
  "runtime.budget_exhausted",
];

/** External inputs are the events replay must re-inject rather than re-derive. */
export const isExternalEvent = <S extends SchemaDef>(event: AnyEvent<S>): boolean =>
  event.causedBy === null && !DERIVED_NULL_CAUSE_TYPES.includes(event.type);

/**
 * Canonical JSON: recursively key-sorted, no whitespace. Total over the
 * JSON-serializable values that event payloads are made of; `undefined`
 * object members are dropped (as JSON.stringify does), keeping the canonical
 * form stable across optional fields.
 */
export const canonicalJson = (value: unknown): string => {
  if (value === null) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`);
    return `{${entries.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

/**
 * Canonical bytes of one event — the determinism/divergence currency. The
 * `branch` label is deliberately excluded: a fork's overlay read returns its
 * parent's prefix with the parent's branch label, and replaying that prefix
 * under the fork's name must not read as divergence. Branch identity is
 * bookkeeping; id/type/payload/causedBy/at are the causal content.
 */
export const canonicalEvent = <S extends SchemaDef>(event: AnyEvent<S>): string =>
  canonicalJson({
    id: event.id,
    type: event.type,
    payload: event.payload,
    causedBy: event.causedBy,
    at: event.at,
  });

/** Canonical bytes of a whole log, one event per line. */
export const canonicalLog = <S extends SchemaDef>(events: Iterable<AnyEvent<S>>): string => {
  const lines: string[] = [];
  for (const event of events) lines.push(canonicalEvent(event));
  return lines.join("\n");
};

/** FNV-1a 64-bit over UTF-16 code units, as fixed-width hex. Pure; no crypto import. */
export const fnv1a64 = (input: string): string => {
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
};

/** The LLM/tool cache key: hash of the canonical request. */
export const hashRequest = (request: unknown): string => fnv1a64(canonicalJson(request));

/** Events recorded during one behavior run, interleaved by `settleStep`. */
export type BehaviorTrace = readonly TraceEntry[];
