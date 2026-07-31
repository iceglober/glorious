/**
 * The composition root — the ONLY place production adapters are picked and
 * wired. Everything else in the library speaks ports. Mirrors the host
 * repo's rule that composition roots wire and never orchestrate.
 */

import { createSystemClock } from "../adapters/clocks";
import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import { createSqliteEventStore } from "../adapters/sqlite-event-store";
import type { AnyBehavior } from "../domain/behaviors";
import type { SchemaDef } from "../domain/schema";
import type { Budget, IdStrategy } from "../domain/step";
import type { Result } from "../lib/fp";
import type { Clock } from "../ports/clock";
import type { EventStore } from "../ports/event-store";
import type { LlmPort } from "../ports/llm";
import type { ToolExecutor } from "../ports/tools";
import type { TracerSink } from "../ports/tracer";
import { createRuntime, type Runtime, type RuntimeError } from "./runtime";

export interface DefaultRuntimeOptions<S extends SchemaDef> {
  readonly schema: S;
  readonly behaviors: readonly AnyBehavior<S>[];
  /** "memory" (default) or a sqlite file path (":memory:" works too). */
  readonly store?: "memory" | { readonly sqlite: string };
  readonly clock?: Clock;
  readonly ids?: IdStrategy;
  readonly llm?: LlmPort;
  readonly tools?: ToolExecutor;
  readonly tracer?: TracerSink<S>;
  readonly budget?: Budget;
  readonly branch?: string;
}

export const createDefaultRuntime = async <S extends SchemaDef>(
  options: DefaultRuntimeOptions<S>,
): Promise<
  Result<{ readonly runtime: Runtime<S>; readonly eventStore: EventStore<S> }, RuntimeError>
> => {
  // Opening a database file is the one wiring step that can fail on the
  // world's terms — a missing directory, a read-only volume, a typo in a
  // path. Every other failure here is already a Result, so this one becomes
  // one rather than escaping as an exception from a function that promises
  // not to throw.
  let eventStore: EventStore<S>;
  try {
    eventStore =
      options.store === undefined || options.store === "memory"
        ? createMemoryEventStore<S>()
        : createSqliteEventStore<S>(options.store.sqlite);
  } catch (error) {
    return {
      ok: false,
      error: {
        reason: "store_error",
        error: {
          reason: "io_error",
          message: `could not open the event store: ${
            error instanceof Error ? error.message : String(error)
          }`,
        },
      },
    };
  }
  const created = await createRuntime({
    schema: options.schema,
    behaviors: options.behaviors,
    eventStore,
    graphStore: createMemoryGraphStore<S>(),
    clock: options.clock ?? createSystemClock(),
    ids: options.ids,
    llm: options.llm,
    tools: options.tools,
    tracer: options.tracer,
    budget: options.budget,
    branch: options.branch,
  });
  if (!created.ok) return created;
  return { ok: true, value: { runtime: created.value, eventStore } };
};
