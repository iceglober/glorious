/**
 * @glrs-dev/activegraph — public barrel.
 *
 * A type-safe TypeScript port of activegraph (Python): an event-sourced graph
 * runtime for durable, stateful agents. The append-only event log is the
 * source of truth; the object/relation graph is a deterministic projection;
 * behaviors react to events by returning typed mutation proposals. Replay,
 * fork, diff, promote, and provenance are first-class.
 *
 * Start at `defineSchema` → `createKit` → `createDefaultRuntime`; see
 * README.md and example.ts for the canonical walkthrough.
 */

export { createFixedClock, createLogicalClock, createSystemClock } from "./adapters/clocks";
export { createFakeLlm, createScriptedLlm, createUnreachableLlm } from "./adapters/fake-llm";
export {
  createMemoryCompletionCache,
  seedCacheFromLog,
  withCompletionCache,
} from "./adapters/llm-cache";
// Adapters
export { createMemoryEventStore } from "./adapters/memory-event-store";
export { createMemoryGraphStore } from "./adapters/memory-graph-store";
export { createRecordedStamps, createRecordedTools } from "./adapters/replay-ports";
export { createSqliteEventStore } from "./adapters/sqlite-event-store";
export type {
  AnyBehavior,
  BehaviorContext,
  BehaviorDef,
  BehaviorRun,
  Kit,
} from "./domain/behaviors";
// Behaviors and combinators
export { createKit, mapMutations, matchBehaviors, when, whereObject } from "./domain/behaviors";
export type { GraphDiff } from "./domain/diff";
// Diff and replay comparison
export { diffGraphs, diffToMutations, emptyDiff } from "./domain/diff";
export type { LlmError, LlmRequest, LlmResponse, ToolError, TraceEntry } from "./domain/effects";
export type {
  AnyEvent,
  BuiltinEventMap,
  EventMap,
  EventName,
  EventOf,
  EventUnion,
} from "./domain/events";
// Events and canonical serialization
export {
  canonicalEvent,
  canonicalJson,
  canonicalLog,
  hashRequest,
  isExternalEvent,
} from "./domain/events";
export type { GraphObject, GraphRelation, GraphState } from "./domain/graph";
// Graph projection and views
export { applyEvent, emptyGraph, project } from "./domain/graph";
export type {
  Mutation,
  MutationBuilder,
  MutationSnapshot,
  RejectionReason,
} from "./domain/mutations";
// Mutations
export { createMutations, toSnapshot, validateMutation } from "./domain/mutations";
export type { Divergence } from "./domain/replay";
export { compareLogs, isPrefixOf } from "./domain/replay";
export type {
  CustomEventName,
  EventId,
  ObjectData,
  ObjectId,
  ObjectTypeName,
  RelationEnds,
  RelationId,
  RelationSource,
  RelationTarget,
  RelationTypeName,
  SchemaDef,
} from "./domain/schema";
// Schema — the generic foundation
export { defineSchema, objectId, relationId } from "./domain/schema";
export type {
  BehaviorOutcome,
  Budget,
  EventStamp,
  IdStrategy,
  PendingApproval,
  RuntimeState,
  SettleResult,
  StepPlan,
} from "./domain/step";
// The pure step (advanced: custom shells, tests)
export {
  appendExternal,
  applyProposals,
  derivedIdStrategy,
  initialState,
  planStep,
  settleStep,
} from "./domain/step";
export type { GraphView } from "./domain/view";
export { createGraphView } from "./domain/view";
export type { Brand, Result } from "./lib/fp";
// FP kernel
export {
  andThen,
  collectResults,
  err,
  fold,
  mapResult,
  ok,
  pipe,
  UnwrapError,
  unwrap,
} from "./lib/fp";
export type { Clock } from "./ports/clock";
// Ports
export type { BranchRecord, EventStore, StoreError } from "./ports/event-store";
export type { GraphStore } from "./ports/graph-store";
export type { CompletionCache, LlmPort } from "./ports/llm";
export type { ToolExecutor } from "./ports/tools";
export type { TracerSink } from "./ports/tracer";
export type { DefaultRuntimeOptions } from "./shell/defaults";
export { createDefaultRuntime } from "./shell/defaults";
export type { PromoteError, PromoteResult } from "./shell/fork";
export { createFork, promote } from "./shell/fork";
export type { ReplayError } from "./shell/replay";
export { replayPermissive, replayStrict } from "./shell/replay";
export type {
  Runtime,
  RuntimeDependencies,
  RuntimeError,
  RuntimeStatus,
} from "./shell/runtime";
// Shell
export { createRuntime } from "./shell/runtime";
export { createConsoleTracer, formatEvent, formatTrace } from "./shell/trace";
