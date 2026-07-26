/**
 * The pure runtime heart: `planStep` decides what one step of the event loop
 * does; `settleStep` folds behavior outcomes into the canonical append
 * sequence. Both are pure and synchronous — given the same state, plan,
 * outcomes, and stamp they produce identical events, which (together with
 * sequential behavior execution in registry order) is what makes the
 * "identical inputs → byte-identical log" contract hold. The impure shell
 * around them is deliberately trivial.
 *
 * Canonical append ordering per dispatched event:
 *   behavior.scheduled × matches                  (from planStep)
 *   then, per behavior in registry order:
 *     behavior.started
 *     llm.requested/llm.responded, tool.requested/tool.responded (call order)
 *     per mutation: patch.proposed → patch.applied + domain event, or
 *                   patch.rejected  (emits skip the patch wrapper: they append
 *                   the custom event directly, or patch.rejected when invalid;
 *                   approval-gated mutations append approval.proposed and park)
 *     behavior.completed | behavior.failed
 *
 * Every appended event is also applied to the graph and enqueued for dispatch
 * inside the same fold, so state and log can never disagree. Thrown behavior
 * errors arrive here as `Result` errors and become `behavior.failed` events —
 * never propagated exceptions.
 *
 * `runtime.idle` is emitted exactly once per drain (guarded by `status`),
 * is itself dispatchable (behaviors may subscribe; budgets bound any loop),
 * and re-arms when new events arrive. Budget exhaustion emits
 * `runtime.budget_exhausted` once and parks the queue; a later call with a
 * looser budget resumes dispatch.
 */
import { fold, type Result } from "../lib/fp";
import { matchBehaviors, type AnyBehavior } from "./behaviors";
import type { AnyEvent, BehaviorTrace } from "./events";
import { applyEvent, emptyGraph, type GraphState } from "./graph";
import {
  toSnapshot,
  validateMutation,
  type Mutation,
  type MutationSnapshot,
} from "./mutations";
import type { EventId, SchemaDef } from "./schema";
import { createGraphView } from "./view";

export interface Budget {
  readonly maxEvents?: number;
  readonly maxSeconds?: number;
}

/** Sampled once per step by the shell; the only source of time in the domain. */
export interface EventStamp {
  readonly at: string;
  readonly elapsedSeconds: number;
}

/**
 * Pure id derivation — determinism with no stateful id port. The default
 * derives from the id of the event that introduces the element.
 */
export type IdStrategy = (hint: {
  readonly eventId: EventId;
  readonly kind: "object" | "relation" | "request" | "approval" | "goal";
  readonly index: number;
  readonly typeName: string;
}) => string;

export const derivedIdStrategy: IdStrategy = (hint) => {
  switch (hint.kind) {
    case "object":
    case "relation":
      return `${hint.typeName}_${hint.eventId}_${hint.index}`;
    case "request":
      return `req_${hint.eventId}_${hint.index}`;
    case "approval":
      return `apv_${hint.eventId}_${hint.index}`;
    case "goal":
      return `goal_${hint.eventId}`;
  }
};

/** A mutation parked behind an approval gate, keyed by approval id. */
export interface PendingApproval<S extends SchemaDef> {
  readonly actor: string;
  readonly mutation: Mutation<S>;
}

export interface RuntimeState<S extends SchemaDef> {
  readonly branch: string;
  readonly graph: GraphState<S>;
  /** Full in-memory log tail for views/provenance; ids are contiguous. */
  readonly log: readonly AnyEvent<S>[];
  /** Appended-but-not-yet-dispatched events. */
  readonly queue: readonly AnyEvent<S>[];
  readonly nextEventId: EventId;
  readonly processed: number;
  readonly status: "running" | "idle" | "budget_exhausted";
  readonly pendingApprovals: ReadonlyMap<string, PendingApproval<S>>;
}

export const initialState = <S extends SchemaDef>(branch: string): RuntimeState<S> => ({
  branch,
  graph: emptyGraph(),
  log: [],
  queue: [],
  nextEventId: 1,
  processed: 0,
  status: "idle",
  pendingApprovals: new Map(),
});

/** Un-id'd event awaiting materialization at the state's next sequence slot. */
interface ProtoEvent {
  readonly type: string;
  readonly payload: unknown;
  readonly causedBy: EventId | null;
}

const materialize = <S extends SchemaDef>(
  state: RuntimeState<S>,
  protos: readonly ProtoEvent[],
  at: string,
): readonly AnyEvent<S>[] =>
  protos.map(
    (proto, index) =>
      ({
        id: state.nextEventId + index,
        branch: state.branch,
        type: proto.type,
        payload: proto.payload,
        causedBy: proto.causedBy,
        at,
      }) as AnyEvent<S>,
  );

/** Append = apply to graph + extend log + enqueue for dispatch, atomically. */
const withAppended = <S extends SchemaDef>(
  state: RuntimeState<S>,
  events: readonly AnyEvent<S>[],
): RuntimeState<S> =>
  events.length === 0
    ? state
    : {
        ...state,
        graph: fold(applyEvent, state.graph, events),
        log: [...state.log, ...events],
        queue: [...state.queue, ...events],
        nextEventId: state.nextEventId + events.length,
        status: "running",
      };

/** Shell entry point for external inputs (goal, custom emit, approval grant). */
export const appendExternal = <S extends SchemaDef>(options: {
  readonly state: RuntimeState<S>;
  readonly entries: readonly { readonly type: string; readonly payload: unknown }[];
  readonly at: string;
}): { readonly state: RuntimeState<S>; readonly appended: readonly AnyEvent<S>[] } => {
  const appended = materialize(
    options.state,
    options.entries.map((entry) => ({ ...entry, causedBy: null })),
    options.at,
  );
  return { state: withAppended(options.state, appended), appended };
};

export type StepPlan<S extends SchemaDef> =
  | {
      readonly kind: "dispatch";
      readonly event: AnyEvent<S>;
      readonly matches: readonly AnyBehavior<S>[];
      /** behavior.scheduled events, already appended into `state`. */
      readonly scheduled: readonly AnyEvent<S>[];
      readonly state: RuntimeState<S>;
    }
  | { readonly kind: "idle"; readonly idleEvent: AnyEvent<S>; readonly state: RuntimeState<S> }
  | {
      readonly kind: "budget_exhausted";
      readonly event: AnyEvent<S>;
      readonly state: RuntimeState<S>;
    }
  | { readonly kind: "stop" };

export const planStep = <S extends SchemaDef>(options: {
  readonly state: RuntimeState<S>;
  readonly behaviors: readonly AnyBehavior<S>[];
  readonly budget: Budget;
  readonly stamp: EventStamp;
}): StepPlan<S> => {
  const { state, behaviors, budget, stamp } = options;
  const next = state.queue[0];
  if (next !== undefined) {
    const limit =
      budget.maxEvents !== undefined && state.processed >= budget.maxEvents
        ? ("max_events" as const)
        : budget.maxSeconds !== undefined && stamp.elapsedSeconds >= budget.maxSeconds
          ? ("max_seconds" as const)
          : null;
    if (limit !== null) {
      if (state.status === "budget_exhausted") return { kind: "stop" };
      const [event] = materialize(
        state,
        [
          {
            type: "runtime.budget_exhausted",
            payload: { limit, processed: state.processed },
            causedBy: null,
          },
        ],
        stamp.at,
      );
      if (event === undefined) return { kind: "stop" };
      return {
        kind: "budget_exhausted",
        event,
        state: { ...withAppended(state, [event]), status: "budget_exhausted" },
      };
    }
    const popped: RuntimeState<S> = {
      ...state,
      queue: state.queue.slice(1),
      processed: state.processed + 1,
    };
    const view = createGraphView({ state: popped.graph, log: popped.log });
    const matches = matchBehaviors({ event: next, behaviors, view });
    const scheduled = materialize(
      popped,
      matches.map((b) => ({
        type: "behavior.scheduled",
        payload: { behavior: b.name, forEvent: next.id },
        causedBy: next.id,
      })),
      stamp.at,
    );
    // Dispatch preserves the pre-dispatch status: only settled appends re-arm
    // the idle latch, so a matchless idle dispatch terminates the drain.
    const status = state.status;
    return {
      kind: "dispatch",
      event: next,
      matches,
      scheduled,
      state: { ...withAppended(popped, scheduled), status },
    };
  }
  if (state.status === "running") {
    const [idleEvent] = materialize(
      state,
      [{ type: "runtime.idle", payload: { processed: state.processed }, causedBy: null }],
      stamp.at,
    );
    if (idleEvent === undefined) return { kind: "stop" };
    return {
      kind: "idle",
      idleEvent,
      state: { ...withAppended(state, [idleEvent]), status: "idle" },
    };
  }
  return { kind: "stop" };
};

/** Erased mutation view; see graph.ts on why generic internals can't narrow. */
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

/**
 * Run proposals through the validate/apply pipeline, folding state as it
 * goes so each proposal sees its predecessors' effects (this is what makes
 * two same-baseVersion patches conflict deterministically). Shared by
 * `settleStep` (behavior outcomes) and the runtime's external `propose`
 * (which is how promote lands a fork's delta on its parent).
 */
export const applyProposals = <S extends SchemaDef>(options: {
  readonly schema: S;
  readonly state: RuntimeState<S>;
  readonly proposals: readonly Mutation<S>[];
  readonly actor: string;
  readonly causedBy: EventId | null;
  readonly at: string;
  readonly ids: IdStrategy;
}): { readonly state: RuntimeState<S>; readonly appended: readonly AnyEvent<S>[] } => {
  const { schema, actor, causedBy, at, ids } = options;
  let state = options.state;
  const appended: AnyEvent<S>[] = [];
  const push = (protos: readonly ProtoEvent[]): readonly AnyEvent<S>[] => {
    const events = materialize(state, protos, at);
    state = withAppended(state, events);
    appended.push(...events);
    return events;
  };

  options.proposals.forEach((mutation, index) => {
    const m = mutation as unknown as ErasedMutation;
    const snapshot = toSnapshot(mutation);

    if (m.kind === "emit") {
      const verdict = validateMutation({ schema, graph: state.graph, mutation });
      if (verdict.ok) {
        push([{ type: m.type ?? "", payload: m.payload, causedBy }]);
      } else {
        push([
          {
            type: "patch.rejected",
            payload: { actor, mutation: snapshot, rejection: verdict.error },
            causedBy,
          },
        ]);
      }
      return;
    }

    if (m.requiresApproval === true) {
      const approvalId = ids({ eventId: state.nextEventId, kind: "approval", index, typeName: actor });
      push([
        {
          type: "approval.proposed",
          payload: { approvalId, actor, mutation: snapshot },
          causedBy,
        },
      ]);
      const { requiresApproval: _gate, ...ungated } = m;
      state = {
        ...state,
        pendingApprovals: new Map(state.pendingApprovals).set(approvalId, {
          actor,
          mutation: ungated as unknown as Mutation<S>,
        }),
      };
      return;
    }

    push([{ type: "patch.proposed", payload: { actor, mutation: snapshot }, causedBy }]);
    const verdict = validateMutation({ schema, graph: state.graph, mutation });
    if (!verdict.ok) {
      push([
        {
          type: "patch.rejected",
          payload: { actor, mutation: snapshot, rejection: verdict.error },
          causedBy,
        },
      ]);
      return;
    }

    // Ids derive from the id the domain event will get: proposed took one slot,
    // applied takes the next, the domain event the one after.
    const domainEventId = state.nextEventId + 1;
    let domainProto: ProtoEvent;
    let appliedSnapshot: MutationSnapshot = snapshot;
    switch (m.kind) {
      case "addObject": {
        const objectId =
          m.id ?? ids({ eventId: domainEventId, kind: "object", index, typeName: m.objectType ?? "" });
        appliedSnapshot = { ...snapshot, id: objectId };
        domainProto = {
          type: "object.created",
          payload: { objectId, objectType: m.objectType, data: m.data },
          causedBy,
        };
        break;
      }
      case "patchObject": {
        const existing = state.graph.objects.get(m.objectId ?? "");
        const baseVersion = m.baseVersion ?? existing?.version ?? 0;
        domainProto = {
          type: "object.patched",
          payload: {
            objectId: m.objectId,
            objectType: existing?.type ?? m.objectType,
            patch: m.patch,
            baseVersion,
            version: (existing?.version ?? 0) + 1,
          },
          causedBy,
        };
        break;
      }
      case "removeObject": {
        const existing = state.graph.objects.get(m.objectId ?? "");
        domainProto = {
          type: "object.removed",
          payload: { objectId: m.objectId, objectType: existing?.type ?? "" },
          causedBy,
        };
        break;
      }
      case "addRelation": {
        const relationId =
          m.id ??
          ids({
            eventId: domainEventId,
            kind: "relation",
            index,
            typeName: m.relationType ?? "",
          });
        appliedSnapshot = { ...snapshot, id: relationId };
        domainProto = {
          type: "relation.created",
          payload: {
            relationId,
            relationType: m.relationType,
            source: m.source,
            target: m.target,
          },
          causedBy,
        };
        break;
      }
      default: {
        const existing = state.graph.relations.get(m.relationId ?? "");
        domainProto = {
          type: "relation.removed",
          payload: { relationId: m.relationId, relationType: existing?.type ?? "" },
          causedBy,
        };
        break;
      }
    }
    push([
      { type: "patch.applied", payload: { actor, mutation: appliedSnapshot }, causedBy },
      domainProto,
    ]);
  });

  return { state, appended };
};

export interface BehaviorOutcome<S extends SchemaDef> {
  readonly behavior: string;
  /** Thrown errors are captured by the shell, never propagated. */
  readonly result: Result<readonly Mutation<S>[], { readonly reason: string }>;
  /** LLM/tool effects performed during the run, in call order. */
  readonly trace: BehaviorTrace;
}

export interface SettleResult<S extends SchemaDef> {
  readonly state: RuntimeState<S>;
  readonly appended: readonly AnyEvent<S>[];
}

export const settleStep = <S extends SchemaDef>(options: {
  readonly schema: S;
  readonly plan: Extract<StepPlan<S>, { kind: "dispatch" }>;
  readonly outcomes: readonly BehaviorOutcome<S>[];
  readonly stamp: EventStamp;
  readonly ids: IdStrategy;
}): SettleResult<S> => {
  const { schema, plan, outcomes, stamp, ids } = options;
  const forEvent = plan.event.id;
  let state = plan.state;
  const appended: AnyEvent<S>[] = [];
  const push = (protos: readonly ProtoEvent[]) => {
    const events = materialize(state, protos, stamp.at);
    state = withAppended(state, events);
    appended.push(...events);
  };

  // An approval grant releases its parked mutation through the normal
  // pipeline before any behavior reactions to the grant itself.
  if (plan.event.type === "approval.granted") {
    const approvalId = (plan.event.payload as { readonly approvalId: string }).approvalId;
    const pending = state.pendingApprovals.get(approvalId);
    if (pending !== undefined) {
      const remaining = new Map(state.pendingApprovals);
      remaining.delete(approvalId);
      state = { ...state, pendingApprovals: remaining };
      const released = applyProposals({
        schema,
        state,
        proposals: [pending.mutation],
        actor: pending.actor,
        causedBy: forEvent,
        at: stamp.at,
        ids,
      });
      state = released.state;
      appended.push(...released.appended);
    }
  }

  for (const outcome of outcomes) {
    push([
      { type: "behavior.started", payload: { behavior: outcome.behavior, forEvent }, causedBy: forEvent },
    ]);
    outcome.trace.forEach((entry, index) => {
      if (entry.kind === "llm") {
        const requestId = ids({ eventId: state.nextEventId, kind: "request", index, typeName: "llm" });
        push([
          {
            type: "llm.requested",
            payload: { requestId, requestHash: entry.requestHash, request: entry.request },
            causedBy: forEvent,
          },
          {
            type: "llm.responded",
            payload: {
              requestId,
              requestHash: entry.requestHash,
              response: entry.response,
              cached: entry.cached,
            },
            causedBy: forEvent,
          },
        ]);
      } else {
        const requestId = ids({ eventId: state.nextEventId, kind: "request", index, typeName: "tool" });
        push([
          {
            type: "tool.requested",
            payload: { requestId, tool: entry.tool, input: entry.input },
            causedBy: forEvent,
          },
          {
            type: "tool.responded",
            payload: {
              requestId,
              tool: entry.tool,
              output: entry.output,
              isError: entry.isError,
            },
            causedBy: forEvent,
          },
        ]);
      }
    });
    if (outcome.result.ok) {
      const applied = applyProposals({
        schema,
        state,
        proposals: outcome.result.value,
        actor: outcome.behavior,
        causedBy: forEvent,
        at: stamp.at,
        ids,
      });
      state = applied.state;
      appended.push(...applied.appended);
      push([
        {
          type: "behavior.completed",
          payload: { behavior: outcome.behavior, forEvent, mutations: outcome.result.value.length },
          causedBy: forEvent,
        },
      ]);
    } else {
      push([
        {
          type: "behavior.failed",
          payload: { behavior: outcome.behavior, forEvent, reason: outcome.result.error.reason },
          causedBy: forEvent,
        },
      ]);
    }
  }

  // Bookkeeping alone must not re-arm the idle latch: a behavior that reacts
  // to runtime.idle but proposes nothing would otherwise loop forever.
  const meaningful = appended.some((event) => !BOOKKEEPING_TYPES.has(event.type));
  return { state: meaningful ? state : { ...state, status: plan.state.status }, appended };
};

const BOOKKEEPING_TYPES: ReadonlySet<string> = new Set([
  "behavior.scheduled",
  "behavior.started",
  "behavior.completed",
  "behavior.failed",
]);
