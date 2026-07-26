/**
 * Replay — the two contracts of the event-sourced design.
 *
 * PERMISSIVE replay reconstructs graph state without running a single
 * behavior: it is literally `project` over the stored log. STRICT replay
 * re-fires behaviors against recorded ports — stamps from the recorded log,
 * tool responses replayed by (tool, input), LLM completions served from a
 * log-seeded cache behind an unreachable port — re-injecting the recorded
 * external inputs at their recorded positions, and comparing canonical bytes
 * after every step. The first mismatch is returned as a `Divergence` naming
 * the exact event id.
 *
 * This module (like defaults.ts) is composition-root territory: it picks the
 * scratch memory adapters for the shadow run. `shell/runtime.ts` itself
 * stays adapter-free.
 */

import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import { createRecordedStamps, createRecordedTools } from "../adapters/replay-ports";
import type { AnyBehavior } from "../domain/behaviors";
import { canonicalEvent, hashRequest, isExternalEvent } from "../domain/events";
import { type GraphState, project } from "../domain/graph";
import { compareLogs, type Divergence } from "../domain/replay";
import type { EventId, SchemaDef } from "../domain/schema";
import type { Budget, IdStrategy } from "../domain/step";
import { err, ok, type Result } from "../lib/fp";
import type { EventStore, StoreError } from "../ports/event-store";
import { createRuntime, type RuntimeError } from "./runtime";

export type ReplayError =
  | { readonly reason: "store_error"; readonly error: StoreError }
  | { readonly reason: "runtime_error"; readonly error: RuntimeError }
  | { readonly reason: "diverged"; readonly divergence: Divergence };

/** Reconstruct state from the log alone — never runs behaviors. */
export const replayPermissive = async <S extends SchemaDef>(options: {
  readonly store: EventStore<S>;
  readonly branch: string;
  readonly toId?: EventId;
}): Promise<Result<GraphState<S>, ReplayError>> => {
  const read = await options.store.read({ branch: options.branch, toId: options.toId });
  if (!read.ok) return err({ reason: "store_error", error: read.error });
  return ok(project<S>(read.value));
};

/**
 * Re-run the branch from scratch against recorded ports and fail on the
 * first divergence. A pass proves the current behavior set still derives the
 * recorded log from its external inputs, byte for byte.
 */
export const replayStrict = async <S extends SchemaDef>(options: {
  readonly schema: S;
  readonly behaviors: readonly AnyBehavior<S>[];
  readonly store: EventStore<S>;
  readonly branch: string;
  readonly budget?: Budget;
  readonly ids?: IdStrategy;
}): Promise<Result<void, ReplayError>> => {
  const read = await options.store.read({ branch: options.branch });
  if (!read.ok) return err({ reason: "store_error", error: read.error });
  const recorded = read.value;
  if (recorded.length === 0) return ok(undefined);

  const { clock, tracer } = createRecordedStamps(recorded);
  const scratchStore = createMemoryEventStore<S>();
  const recordedCompletions = new Map<string, { readonly text: string }>();
  for (const event of recorded) {
    if ((event.type as string) !== "llm.responded") continue;
    const payload = event.payload as { requestHash: string; response: { text: string } };
    if (!recordedCompletions.has(payload.requestHash)) {
      recordedCompletions.set(payload.requestHash, payload.response);
    }
  }
  const created = await createRuntime({
    schema: options.schema,
    behaviors: options.behaviors,
    eventStore: scratchStore,
    graphStore: createMemoryGraphStore<S>(),
    clock,
    tracer,
    ids: options.ids,
    budget: options.budget,
    tools: createRecordedTools(recorded),
    // Completions are served from the recording, keyed by canonical request
    // hash. A miss means the behaviors asked a question the recording never
    // answered; the resulting behavior.failed then differs from the recorded
    // log and surfaces as divergence.
    llm: {
      complete: async (request) => {
        const hit = recordedCompletions.get(hashRequest(request));
        return hit !== undefined
          ? ok(hit)
          : err({ reason: "provider_error", message: "no recorded completion for request" });
      },
    },
    branch: options.branch,
  });
  if (!created.ok) return err({ reason: "runtime_error", error: created.error });
  const runtime = created.value;

  const externals = recorded.filter((event) => isExternalEvent(event));
  let cursor = 0;

  const check = (): Divergence | null => {
    const verdict = compareLogs(recorded, runtime.log());
    return verdict.ok ? null : verdict.error;
  };

  for (;;) {
    // Inject every external input that belongs at the current head.
    for (;;) {
      const nextExternal = externals[cursor];
      if (nextExternal === undefined) break;
      const head = runtime.log().length;
      if (nextExternal.id !== head + 1) break;
      const injected = await runtime.inject(nextExternal.type, nextExternal.payload);
      if (!injected.ok) return err({ reason: "runtime_error", error: injected.error });
      cursor += 1;
      const divergence = check();
      if (divergence !== null) return err({ reason: "diverged", divergence });
    }
    const stepped = await runtime.runQuantum();
    if (!stepped.ok) return err({ reason: "runtime_error", error: stepped.error });
    const divergence = check();
    if (divergence !== null) return err({ reason: "diverged", divergence });
    if (stepped.value.stepped === "stop") {
      if (externals[cursor] !== undefined || runtime.log().length < recorded.length) {
        const missing = recorded[runtime.log().length];
        return err({
          reason: "diverged",
          divergence: {
            atEventId: missing?.id ?? runtime.log().length + 1,
            expected: missing === undefined ? "" : canonicalEvent(missing),
            actual: "",
          },
        });
      }
      return ok(undefined);
    }
  }
};
