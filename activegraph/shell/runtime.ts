/**
 * The impure shell around the pure step functions — deliberately trivial: it
 * samples the clock, calls `planStep`, persists what the plan already
 * integrated, runs matched behaviors SEQUENTIALLY IN REGISTRY ORDER
 * (capturing throws as Results), calls `settleStep`, persists, repeats.
 * Every decision lives in the domain; this file only performs.
 *
 * Depends on PORTS ONLY (never adapters): which store/clock/LLM to use is the
 * composition root's business (`shell/defaults.ts`).
 *
 * Determinism contract: with a deterministic clock, id strategy, behaviors,
 * and LLM/tool ports, two runs from the same external inputs produce
 * byte-identical canonical logs. The pieces that make that true here: one
 * clock sample per step, sequential behavior execution, and the per-branch
 * completion cache seeded from the log's own llm.responded events (so
 * rehydrated runs and forks reuse recorded completions instead of re-calling
 * providers).
 *
 * In-memory state is only advanced after the event store acknowledges the
 * append, so a failed persist leaves the runtime consistent with the store.
 */

import type { AnyBehavior, BehaviorContext } from "../domain/behaviors";
import type { LlmResponse, TraceEntry } from "../domain/effects";
import { type AnyEvent, type EventMap, hashRequest } from "../domain/events";
import { project } from "../domain/graph";
import { createMutations, type Mutation } from "../domain/mutations";
import type { CustomEventName, EventId, SchemaDef } from "../domain/schema";
import {
  appendExternal,
  applyProposals,
  type BehaviorOutcome,
  type Budget,
  derivedIdStrategy,
  type IdStrategy,
  initialState,
  type PendingApproval,
  planStep,
  type RuntimeState,
  settleStep,
} from "../domain/step";
import { createGraphView, type GraphView } from "../domain/view";
import { err, ok, type Result } from "../lib/fp";
import type { Clock } from "../ports/clock";
import type { EventStore, StoreError } from "../ports/event-store";
import type { GraphStore } from "../ports/graph-store";
import type { LlmPort } from "../ports/llm";
import type { ToolExecutor } from "../ports/tools";
import type { TracerSink } from "../ports/tracer";

export interface RuntimeDependencies<S extends SchemaDef> {
  readonly schema: S;
  readonly behaviors: readonly AnyBehavior<S>[];
  readonly eventStore: EventStore<S>;
  readonly graphStore: GraphStore<S>;
  readonly clock: Clock;
  readonly ids?: IdStrategy;
  readonly llm?: LlmPort;
  readonly tools?: ToolExecutor;
  readonly tracer?: TracerSink<S>;
  readonly budget?: Budget;
  readonly branch?: string;
}

export type RuntimeError =
  | { readonly reason: "store_error"; readonly error: StoreError }
  | { readonly reason: "invalid_payload"; readonly issues: readonly string[] };

export interface RuntimeStatus {
  readonly branch: string;
  readonly headEventId: EventId;
  readonly processed: number;
  readonly queueDepth: number;
  readonly status: "running" | "idle" | "budget_exhausted";
  readonly pendingApprovals: readonly string[];
}

export interface Runtime<S extends SchemaDef> {
  /** Append goal.created and drain to idle (or budget exhaustion). */
  readonly runGoal: (text: string) => Promise<Result<RuntimeStatus, RuntimeError>>;
  readonly runUntilIdle: () => Promise<Result<RuntimeStatus, RuntimeError>>;
  /** Exactly one planned step; "stop" means there was nothing to do. */
  readonly runQuantum: () => Promise<
    Result<
      {
        readonly stepped: "dispatch" | "idle" | "budget_exhausted" | "stop";
        readonly status: RuntimeStatus;
      },
      RuntimeError
    >
  >;
  /** Append a custom external event (validated); does not drain. */
  readonly emit: <K extends CustomEventName<S>>(
    type: K,
    payload: EventMap<S>[K],
  ) => Promise<Result<RuntimeStatus, RuntimeError>>;
  /**
   * Append an external event of ANY type with an exact payload, unvalidated.
   * The replay driver's tool for re-injecting recorded external inputs;
   * normal callers want `emit`/`runGoal`/`grantApproval`.
   */
  readonly inject: (type: string, payload: unknown) => Promise<Result<RuntimeStatus, RuntimeError>>;
  /** Run proposals through validate/apply outside any behavior (promote uses this). */
  readonly propose: (
    mutations: readonly Mutation<S>[],
    options?: { readonly actor?: string },
  ) => Promise<
    Result<
      { readonly status: RuntimeStatus; readonly appended: readonly AnyEvent<S>[] },
      RuntimeError
    >
  >;
  readonly grantApproval: (approvalId: string) => Promise<Result<RuntimeStatus, RuntimeError>>;
  readonly status: () => RuntimeStatus;
  readonly view: () => GraphView<S>;
  readonly log: () => readonly AnyEvent<S>[];
}

/** Rebuild parked approvals from the log: proposals not yet granted. */
const pendingFromLog = <S extends SchemaDef>(
  log: readonly AnyEvent<S>[],
): ReadonlyMap<string, PendingApproval<S>> => {
  const pending = new Map<string, PendingApproval<S>>();
  for (const event of log) {
    const type = event.type as string;
    if (type === "approval.proposed") {
      const payload = event.payload as { approvalId: string; actor: string; mutation: unknown };
      pending.set(payload.approvalId, {
        actor: payload.actor,
        mutation: payload.mutation as Mutation<S>,
      });
    } else if (type === "approval.granted") {
      pending.delete((event.payload as { approvalId: string }).approvalId);
    }
  }
  return pending;
};

export const createRuntime = async <S extends SchemaDef>(
  deps: RuntimeDependencies<S>,
): Promise<Result<Runtime<S>, RuntimeError>> => {
  const { schema, behaviors, eventStore, graphStore, clock } = deps;
  const ids = deps.ids ?? derivedIdStrategy;
  const budget = deps.budget ?? {};
  const branch = deps.branch ?? "main";
  const m = createMutations(schema);

  // Rehydrate: the branch's overlay log is the whole truth.
  const existing = await eventStore.branch(branch);
  if (!existing.ok) return err({ reason: "store_error", error: existing.error });
  if (existing.value === null) {
    const created = await eventStore.createBranch({
      name: branch,
      parent: null,
      baseEventId: null,
    });
    if (!created.ok) return err({ reason: "store_error", error: created.error });
  }
  const read = await eventStore.read({ branch });
  if (!read.ok) return err({ reason: "store_error", error: read.error });
  const rehydrated = read.value;

  let state: RuntimeState<S> = {
    ...initialState<S>(branch),
    graph: project(rehydrated),
    log: rehydrated,
    nextEventId: (rehydrated[rehydrated.length - 1]?.id ?? 0) + 1,
    pendingApprovals: pendingFromLog(rehydrated),
  };
  graphStore.reset(state.graph);

  // Per-branch completion cache, seeded from the log so replayed prefixes and
  // forks serve recorded completions. Deliberately a plain map: the port-level
  // CompletionCache seam is for cross-run persistence (see adapters/llm-cache).
  const completions = new Map<string, LlmResponse>();
  for (const event of rehydrated) {
    if ((event.type as string) !== "llm.responded") continue;
    const payload = event.payload as { requestHash: string; response: LlmResponse };
    if (!completions.has(payload.requestHash))
      completions.set(payload.requestHash, payload.response);
  }

  const persist = async (events: readonly AnyEvent<S>[]): Promise<Result<void, RuntimeError>> => {
    if (events.length === 0) return ok(undefined);
    const appended = await eventStore.append(events);
    if (!appended.ok) return err({ reason: "store_error", error: appended.error });
    graphStore.apply(events);
    for (const event of events) deps.tracer?.onEvent(event);
    return ok(undefined);
  };

  const currentView = () => createGraphView({ state: state.graph, log: state.log });

  const makeCtx = (
    view: GraphView<S>,
  ): { readonly ctx: BehaviorContext<S>; readonly trace: TraceEntry[] } => {
    const trace: TraceEntry[] = [];
    const ctx: BehaviorContext<S> = {
      view,
      m,
      llm: async (request) => {
        const requestHash = hashRequest(request);
        const hit = completions.get(requestHash);
        if (hit !== undefined) {
          trace.push({ kind: "llm", requestHash, request, response: hit, cached: true });
          return ok(hit);
        }
        if (deps.llm === undefined) return err({ reason: "no_llm_port" });
        const result = await deps.llm.complete(request);
        if (result.ok) {
          completions.set(requestHash, result.value);
          trace.push({ kind: "llm", requestHash, request, response: result.value, cached: false });
        }
        return result;
      },
      tool: async (name, input) => {
        if (deps.tools === undefined) return err({ reason: "no_tool_executor" });
        const result = await deps.tools.execute(name, input);
        trace.push({
          kind: "tool",
          tool: name,
          input,
          output: result.ok
            ? result.value
            : "message" in result.error
              ? result.error.message
              : result.error.reason,
          isError: !result.ok,
        });
        return result;
      },
    };
    return { ctx, trace };
  };

  const status = (): RuntimeStatus => ({
    branch,
    headEventId: state.nextEventId - 1,
    processed: state.processed,
    queueDepth: state.queue.length,
    status: state.status,
    pendingApprovals: [...state.pendingApprovals.keys()],
  });

  /** One planned step. Advances `state` only after successful persistence. */
  const stepOnce = async (
    startSeconds: number,
  ): Promise<Result<"dispatch" | "idle" | "budget_exhausted" | "stop", RuntimeError>> => {
    const stamp = {
      at: clock.now(),
      elapsedSeconds: clock.monotonicSeconds() - startSeconds,
    };
    const plan = planStep({ state, behaviors, budget, stamp });
    switch (plan.kind) {
      case "stop":
        return ok("stop");
      case "idle": {
        const persisted = await persist([plan.idleEvent]);
        if (!persisted.ok) return persisted;
        state = plan.state;
        return ok("idle");
      }
      case "budget_exhausted": {
        const persisted = await persist([plan.event]);
        if (!persisted.ok) return persisted;
        state = plan.state;
        return ok("budget_exhausted");
      }
      case "dispatch": {
        const persisted = await persist(plan.scheduled);
        if (!persisted.ok) return persisted;
        // All matched behaviors observe the same dispatch-time view; their
        // proposals settle sequentially afterwards.
        const view = createGraphView({ state: plan.state.graph, log: plan.state.log });
        const outcomes: BehaviorOutcome<S>[] = [];
        for (const behavior of plan.matches) {
          const { ctx, trace } = makeCtx(view);
          try {
            const mutations = await behavior.run(plan.event, ctx);
            outcomes.push({ behavior: behavior.name, result: ok(mutations), trace });
          } catch (cause) {
            const reason = cause instanceof Error ? cause.message : String(cause);
            outcomes.push({ behavior: behavior.name, result: err({ reason }), trace });
          }
        }
        const settled = settleStep({ schema, plan, outcomes, stamp, ids });
        const settleOk = await persist(settled.appended);
        if (!settleOk.ok) return settleOk;
        state = settled.state;
        return ok("dispatch");
      }
    }
  };

  const drain = async (): Promise<Result<RuntimeStatus, RuntimeError>> => {
    const startSeconds = clock.monotonicSeconds();
    for (;;) {
      const stepped = await stepOnce(startSeconds);
      if (!stepped.ok) return stepped;
      if (stepped.value === "stop") return ok(status());
    }
  };

  const appendEntries = async (
    entries: readonly { readonly type: string; readonly payload: unknown }[],
  ): Promise<Result<RuntimeStatus, RuntimeError>> => {
    const result = appendExternal({ state, entries, at: clock.now() });
    const persisted = await persist(result.appended);
    if (!persisted.ok) return persisted;
    state = result.state;
    return ok(status());
  };

  return ok({
    runGoal: async (text) => {
      const goalId = ids({ eventId: state.nextEventId, kind: "goal", index: 0, typeName: "goal" });
      const appended = await appendEntries([{ type: "goal.created", payload: { goalId, text } }]);
      if (!appended.ok) return appended;
      return drain();
    },
    runUntilIdle: drain,
    runQuantum: async () => {
      const stepped = await stepOnce(clock.monotonicSeconds());
      if (!stepped.ok) return stepped;
      return ok({ stepped: stepped.value, status: status() });
    },
    emit: async (type, payload) => {
      const eventSchema = schema.events[type];
      if (eventSchema !== undefined) {
        const parsed = eventSchema.safeParse(payload);
        if (!parsed.success) {
          return err({
            reason: "invalid_payload",
            issues: parsed.error.issues.map((issue) => issue.message),
          });
        }
      }
      return appendEntries([{ type, payload }]);
    },
    inject: (type, payload) => appendEntries([{ type, payload }]),
    propose: async (mutations, options) => {
      const result = applyProposals({
        schema,
        state,
        proposals: mutations,
        actor: options?.actor ?? "external",
        causedBy: null,
        at: clock.now(),
        ids,
      });
      const persisted = await persist(result.appended);
      if (!persisted.ok) return persisted;
      state = result.state;
      return ok({ status: status(), appended: result.appended });
    },
    grantApproval: (approvalId) =>
      appendEntries([{ type: "approval.granted", payload: { approvalId } }]),
    status,
    view: currentView,
    log: () => state.log,
  });
};
