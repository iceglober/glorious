# @glrs-dev/activegraph

A **type-safe TypeScript port of [activegraph](https://github.com/yoheinakajima/activegraph)**
(Python, by Yohei Nakajima) — an event-sourced graph runtime for durable, stateful agents — built
as a **pure hexagonal architecture** with a **functional core and functional composition** as the
API style.

The inversion the original is built on is preserved exactly: the **append-only event log is the
source of truth**, and the working graph of objects and typed relations is a **deterministic
projection** of that log. Behaviors react to events and *propose* mutations; the runtime
validates and applies them (rejections become events, never exceptions). Any run can be
**replayed**, **forked** at any historical event, **diffed**, and **promoted** back; every graph
element traces to the event that caused it.

What the port adds is compile-time safety. The Python library is stringly typed
(`add_object("task", {...})`); here, one `defineSchema` call threads generics through the entire
API — zod-checked object data, ids **branded by object type** so relation endpoints can't be
crossed, event payloads narrowed by subscription, all with zero casts at call sites.

## Quickstart

```ts
import { z } from "zod";
import { createDefaultRuntime, createKit, defineSchema, unwrap } from "@glrs-dev/activegraph";

// 1. One schema call fixes the vocabulary; every generic flows from it.
const schema = defineSchema({
  objects: {
    task: z.object({ title: z.string(), status: z.enum(["open", "blocked", "done"]) }),
    claim: z.object({ text: z.string(), confidence: z.number().min(0).max(1) }),
  },
  relations: {
    depends_on: { source: "task", target: "task" }, // endpoint typos = compile error
  },
  events: {
    "task.completed": z.object({ taskId: z.string() }),
  },
});

// 2. Behaviors are plain composable values. `on` narrows the payload type.
const kit = createKit(schema);

const planner = kit.behavior({
  name: "planner",
  on: ["goal.created"],
  run: (_event, ctx) => [
    ctx.m.addObject("task", { title: "Research", status: "open" }),
    ctx.m.addObject("task", { title: "Draft memo", status: "blocked" }),
  ],
});

const researcher = kit.behavior({
  name: "researcher",
  on: ["object.created"],
  where: (event) =>
    event.payload.objectType === "task" && // narrows event.payload.data to the task shape
    event.payload.data.status === "open" &&
    event.payload.data.title.includes("Research"),
  run: (event, ctx) =>
    event.type === "object.created" && event.payload.objectType === "task"
      ? [
          ctx.m.addObject("claim", { text: "Market early but growing.", confidence: 0.7 }),
          ctx.m.emit("task.completed", { taskId: event.payload.objectId }),
        ]
      : [],
});

// Coordination logic on the edge, not on either endpoint.
const unblock = kit.relationBehavior({
  name: "unblock",
  relationType: "depends_on",
  on: ["task.completed"],
  run: ({ event, relation, ctx }) =>
    event.type === "task.completed" && event.payload.taskId === relation.target
      ? [ctx.m.patchObject("task", relation.source, { status: "open" })]
      : [],
});

// 3. Compose a runtime and run a goal.
const { runtime } = await unwrap(
  createDefaultRuntime({
    schema,
    behaviors: [planner, researcher, unblock],
    store: { sqlite: "run.db" }, // or "memory" (default)
    budget: { maxEvents: 200, maxSeconds: 60 },
  }),
);

const status = await unwrap(runtime.runGoal("Evaluate this startup idea"));
runtime.view().objects("task"); // GraphObject<S, "task">[] — data fully typed
```

The full executable version of this walkthrough lives in [`example.ts`](example.ts) and runs in
[`shell/runtime.test.ts`](shell/runtime.test.ts); a narrated demo with printed traces is
[`examples/rpa-repair.demo.ts`](examples/rpa-repair.demo.ts).

## Errors: two spellings, pick per call site

Every fallible call returns a typed `Result<T, E>` and never throws. Handle it explicitly, or
pass the promise straight through `unwrap` to convert errors into a thrown `UnwrapError`
(which carries the typed error on `.error`):

```ts
// explicit, non-throwing — full typed error handling
const result = await runtime.runGoal("...");
if (!result.ok) return report(result.error); // { reason: "store_error", ... } | ...

// throwing shorthand — for scripts, tests, and "this should never fail" paths
const status = await unwrap(runtime.runGoal("..."));
```

## Architecture

Pure hexagonal, dependency direction strictly inward; the layering is enforced by
[`architecture.test.ts`](architecture.test.ts), which fails on any violating import.

```
lib/fp.ts    the FP kernel: Result, pipe, fold, Brand (no fp-ts)
domain/      pure functions only — imports zod + lib, nothing else.
             schema, events (canonical serialization), graph (projection as a
             fold), view, mutations (+validation), behaviors (+combinators),
             step (planStep/settleStep — the pure runtime heart), diff, replay
ports/       interfaces: EventStore, GraphStore, Clock, IdStrategy, LlmPort +
             CompletionCache, ToolExecutor, TracerSink
adapters/    implementations; the only layer touching bun:/node: APIs.
             memory + bun:sqlite event stores (one shared contract suite),
             memory graph store, clocks, fake/scripted LLMs, completion cache,
             recorded replay ports
shell/       the thin impure interpreter. runtime.ts (ports only), replay.ts,
             fork.ts, trace.ts, defaults.ts (the composition root)
```

Functional style throughout: no classes, `createX` closure factories, tagged-union errors
(`{ ok: true } | { ok: false; error }`), behaviors as values transformed by combinators
(`when`, `whereObject`, `mapMutations`) composed with `pipe`, the projection as a literal fold
`(GraphState, Event) => GraphState`, and the runtime step as pure functions
`planStep : State -> Plan` / `settleStep : Plan × Outcomes -> (State, Events)` interpreted by a
deliberately trivial impure loop.

## The determinism contract

With deterministic inputs (clock, id strategy, behaviors, LLM/tool ports), **identical external
inputs produce byte-identical canonical logs** (`canonicalLog` — recursively key-sorted JSON).
The pieces that make it hold:

- one clock sample per step, injected — the domain never reads time;
- ids derived purely from the introducing event id (`derivedIdStrategy`) — no id state;
- behaviors run sequentially in registry order; settle ordering is pure and canonical;
- LLM calls are hashed (canonical-JSON FNV-1a), logged as `llm.requested`/`llm.responded`
  events, and served from a cache seeded by the branch's own log — so **replay and forks never
  re-call a provider**.

On top of that contract:

- **`replayPermissive`** — reconstruct state from the log alone (it is literally `project`).
- **`replayStrict`** — re-run behaviors against recorded ports and report the first
  **`Divergence`** with the exact event id and both canonical byte strings.
- **`createFork`** — O(1) overlay branch at any event id (no events copied);
  **`promote`** — diff the fork against the parent-at-base and land the delta through the
  parent's normal validate/apply pipeline, so concurrent parent edits surface as
  `patch.rejected` (`version_conflict`) events rather than silent clobbers.

## Event vocabulary

The fixed lifecycle events of the Python original (`goal.created`, `object.created/patched/
removed`, `relation.created/removed`, `behavior.scheduled/started/completed/failed`,
`patch.proposed/applied/rejected`, `llm.requested/responded`, `tool.requested/responded`,
`approval.proposed/granted`, `runtime.idle`, `runtime.budget_exhausted`) plus custom events
declared in the schema. Every event carries `causedBy` — the provenance chain — and
`view.provenance(id)` walks it from any object back to the external input that caused it.

## Scope (v1)

Faithful core, tight fence: no CLI, no packs system, no Prometheus, no Postgres/FalkorDB
adapters, no embedding providers, and no real LLM provider adapter (the `LlmPort` seam plus
deterministic fakes and the caching decorator ship instead; an ai-sdk adapter is a clean later
addition). Approvals have minimal semantics: a mutation marked `requiresApproval` parks behind
`approval.proposed` until `grantApproval` releases it through the normal pipeline.

## Tests

`bun test activegraph` — 135+ colocated tests, including the compile-time contract suite
(`domain/types.test.ts`, `@ts-expect-error` regressions), the store contract run against both
adapters, byte-identical-log determinism, strict-replay divergence detection, fork/promote
conflicts, and the mechanical hexagon check.
