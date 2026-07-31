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

## Running the coding agent

The coding-agent example uses the Azure adapter and persists its event log to `coding-agent.db`.
Configure an Azure deployment, then run:

```bash
# Copy .env.example to .env and fill in the values, or export them in your shell.
cp .env.example .env
bun activegraph/examples/run-coding-agent.ts "Inspect this project"
```

A run narrates itself: which behavior is thinking, and any failure as the provider's own sentence
rather than nested JSON — see [`trace-view.ts`](examples/trace-view.ts). `ACTIVEGRAPH_TRACE=1` swaps
that for the full event stream with canonical payloads, which is what you want when debugging the
runtime rather than the run.

Commands narrate themselves separately, through [`tool-progress.ts`](examples/tool-progress.ts),
because the events cannot do it: `tool.requested` and `tool.responded` are collected inside the
behavior and materialized when the step settles, so both carry the step's single clock stamp. A
twelve-second command appends two events with identical timestamps, after it has already finished —
the log knows a command ran, not how long it took, and nothing appends while it is running. So the
tool decorator announces the command, says "still running" every five seconds, and reports the real
elapsed time.

The runner loads `.env` automatically with `dotenv`; shell environment variables still take precedence. See `.env.example` for the supported variables. Set `ACTIVEGRAPH_DB` to choose another SQLite file. Commands run in the current working directory;
destructive-looking ones stop for approval first. It prints the ActiveGraph lifecycle as events
are appended, plans, executes, reviews, records the results, and exits. Command output
is limited to `ACTIVEGRAPH_MAX_OUTPUT` characters (4,000 by default); set that variable to change the
limit.

Seven behaviors close the loop. `settingsRecorder` and `recorder` fold the operator's knobs and the
sampled workspace into the graph, `declineRecorder` records a refusal, `planner` turns
the goal into commands, `executor` runs each one and
writes its output back into the graph, `finisher` settles the task once the newest round of commands
is terminal, and `reviewer` reads that output and either reports done or proposes another round —
which is what lets a failed command be retried instead of just recorded. Rounds are capped by
`ACTIVEGRAPH_MAX_ROUNDS` (2 by default; `0` reviews without ever adding work), each command's output
is clipped to 2,000 characters inside the reviewer's prompt, and the task's status follows the newest
round, so a successful retry moves a `failed` task back to `completed` while the failed round stays in
the graph as history.

Goals accumulate. The log outlives a run, so `planner` is shown the last `ACTIVEGRAPH_HISTORY` (3)
finished goals from this directory — request and reviewer report, each clipped to 400 characters — and
a second goal can build on the first instead of rediscovering the project. History is scoped by the
task's recorded `cwd`, because one event log may serve several directories and another project's work
is misleading there. Set `ACTIVEGRAPH_HISTORY=0` to plan with no memory. Like the workspace and the
model, history reaches the model through the request, so it is part of the cache key by construction:
a goal issued against a log that has grown re-plans rather than replaying its own earlier answer,
while a true replay of a recorded log still serves every completion from the recording.

Any recorded log can be checked against the behaviors that produced it:

```bash
bun activegraph/examples/verify-log.ts coding-agent.db   # or: bun run verify-log
```

It summarises the branch, replays it with `createCodingAgentBehaviors()` — no arguments, which is the
property being tested — and either confirms the branch re-derives from itself or names the fields
that differ at the first divergent event. No provider is reached: every completion is served from the
recording, so it is offline and free. This exists because the unit tests were green while every
approval-gated log on disk was unreplayable; they built their runtimes with default settings and
never exercised the configuration the runner used. Replaying a real log is what catches that, and it
is worth a command rather than a script written from memory. Note that it compares against *today's*
behaviors, so a log recorded before a behavior changed is expected to diverge — that is the tool
working, not the log rotting.

Every run ends by saying what it did to the working tree. The runner re-samples the workspace, emits
it as a second `workspace.sampled` so the log holds the state the run left as well as the one it
started from, and [`workspace-diff.ts`](examples/workspace-diff.ts) reports what appeared, what went
away, and what is newly uncommitted. Command output cannot answer that question — a command that
writes a file usually prints nothing — and "working tree: unchanged" after a read-only goal is worth
as much as the list after a destructive one.

Every run also ends with what it cost, folded out of the log by
[`run-summary.ts`](examples/run-summary.ts): calls made, how many the log's own cache answered,
characters of context sent and saved, commands run, and the provider's token counts — including
reasoning tokens, which are otherwise invisible and were 40% of the output on a one-command goal.
The Azure adapter records `usage` inside `llm.responded`, so the numbers are durable: `summarizeRun`
is a pure fold and works on last week's branch as well as on the run that just finished. The runner
counts only the events this run appended, not the whole branch.

A risky-looking command always waits for a person, whatever the configuration: `looksDestructive`
matches `sudo`, `mkfs`, `dd`, `rm -rf`, `git reset --hard`, `git clean -f`, and force-pushes, and
those commands park behind an approval while everything else runs untouched. It matches only in
command position — line start, after a separator, or handed to something that execs its argument, so
`find … -exec rm -rf {} +` and `xargs rm -f` are caught while `grep -r "sudo" .` and
`cat notes/dd/readme.md` are not. The examples are the specification and live in
[`risky-command.test.ts`](examples/risky-command.test.ts): a miss runs something unseen, and a false
alarm trains the operator to stop reading the prompt, which costs more than the alarm was worth. This replaces the
blocklist the shell tool used to carry, which was wrong twice over — it matched text rather than
intent, and a flat refusal is the very signal that provokes a rewrite. Asking still covers the
accident (a careless `rm -rf` cannot run unseen) without pretending to stop a determined model. The
tool itself now refuses nothing, because a tool that rejects an already-approved command is answering
a question the operator has already answered.

`ACTIVEGRAPH_APPROVE=1` extends that from risky commands to every command. The planner marks each command
mutation `requiresApproval`, so it parks behind an `approval.proposed` event instead of applying —
and because `executor` fires on `object.created`, an event that never happens, the shell sees nothing
until you release it with `grantApproval`. A non-interactive stdin declines: for something holding a
shell, failing closed is the only safe default.

The question is asked per command, not per batch, because five proposed commands with one bad line
should cost you that line and not the other four. Each command parks two mutations — the object and
the edge attaching it to the task — and [`approvals.ts`](examples/approvals.ts) groups them so a
release covers both, in proposal order, since an edge cannot attach to an object that does not exist
yet. A declined command simply never becomes an object, so the task settles on the work that was
allowed to happen, and each review round asks about its own batch.

A refusal is fed back rather than just enforced. The runner emits `command.declined`, which records
the command on the task and — when the refusal left the round with nothing to run — settles the task,
which is what wakes `reviewer`. It is shown what was refused and gets a round to propose something
you might allow. Note what that does *not* mean: told "no" to `find … -exec rm -rf`, a model will
happily offer the same deletion in Python, which sails past the destructive-command regex. The
reviewer is instructed that a different tool for the same action is still the refused action, and in
practice it now stops and says the work needs the operator — but the instruction is a nudge, not a
control. The per-command gate is the control.

A reply that is not usable JSON costs a re-ask rather than the run. `llmBehavior` takes `retries`
(the agent uses 1) and re-asks with the complaint appended — a distinct request, so it is logged and
hashed like any other and replays from the recording. The reviewer is the case that makes this worth
having: its commands have already run by then, so losing the round to a parse failure means a re-run
repeats all of that work.

Command output is redacted before anything sees it. The log is durable and the reviewer's prompt is
sent to a provider, so one `cat .env` would otherwise write a live credential to disk forever and
hand it to the model. [`shell-tool.ts`](examples/shell-tool.ts) masks by *value*, not by name: every
environment variable whose name looks secret (`KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `CREDENTIAL`,
`AUTH`) and whose value is at least 8 characters is replaced with `[redacted]` wherever it appears in
stdout, stderr, or an error message. Because `dotenv` loads `.env` into the environment, this covers
reading that file as well as printing the variable. Short values are left alone; masking every `1`
and `true` would mangle output without protecting anything.

Commands run under an explicit contract. `executor` puts the workspace directory and the limits into
the tool input, and [`shell-tool.ts`](examples/shell-tool.ts) enforces them: the command runs in that
directory rather than wherever the process happens to be, `ACTIVEGRAPH_COMMAND_TIMEOUT_MS` (120s)
kills one that overruns, and `ACTIVEGRAPH_MAX_OUTPUT_BYTES` (1MB) kills one that floods — which also
bounds what a single command can append to the durable log. Because the contract travels in the
input, every `tool.requested` event records where its command ran and under which limits.

Before planning, the runner samples a `Workspace` — cwd, top-level entry names, and, inside a
repository, the git root, the checked-out branch, and the porcelain status lines for uncommitted work
(capped at 20, with the overflow counted rather than dropped in silence) — and emits it as a
`workspace.sampled` event. Knowing the branch and what is dirty is what keeps a plan from checking
out over work in progress; the planner is told to treat uncommitted changes as work it must not
discard unless the goal says so. A `recorder` behavior folds it into the graph, and the
planner, executor, and reviewer all read it from there; the deployment name rides in the request
alongside it. Behaviors never read `process.cwd()`, so they stay pure functions of their inputs. The operator's
knobs — model, review rounds, history depth, command limits, whether commands need approval — arrive
the same way, as a `settings.configured` event, with defaults living in code. So **the log holds
everything the run depended on**: `replayStrict` re-derives a recorded branch from the branch alone,
no arguments, even across sessions whose directory contents differed. Constructor arguments are
exactly what a self-contained log must not depend on — a branch recorded under `approveCommands`
replayed as an ungated one while that flag lived in a function call, because the planner's mutations
were no longer marked and `approval.proposed` never appeared. Nothing sampled, nothing guessed — with no
`workspace.sampled` on the log the executor fails its commands with a message saying so rather than
running somewhere the plan never saw. This is also what keeps caching correct: completions are keyed on the request bytes (see
[The determinism contract](#the-determinism-contract)), so a plan is reused only when the goal, the
directory, *and* the model all match. Point `ACTIVEGRAPH_DB` at one shared file across two projects,
or change `ACTIVEGRAPH_MODEL` against an existing log, and the agent re-plans instead of replaying
the previous answer. The Azure adapter honours `LlmRequest.model` and falls back to the deployment it
was constructed with, so a behavior can name the model it wants.

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
             memory graph store, clocks, fake/scripted/Azure LLMs, completion cache,
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
  re-call a provider**;
- rehydration restores the dispatch count, so a branch grown by successive processes — the case a
  persistent store exists for — replays as one continuous run instead of diverging on the
  `processed` field of its own `runtime.idle` events.

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

Faithful core, tight fence: no packs system, no Prometheus, no Postgres/FalkorDB adapters, and no
embedding providers. The Azure AI SDK adapter is included for the coding-agent example; the
`LlmPort` seam, deterministic fakes, and caching decorator remain available for other providers.
Approvals have minimal semantics: a mutation marked `requiresApproval` parks behind
`approval.proposed` until `grantApproval` releases it through the normal pipeline.

## Tests

`bun test activegraph` — 160+ colocated tests, including the compile-time contract suite
(`domain/types.test.ts`, `@ts-expect-error` regressions), the store contract run against both
adapters, byte-identical-log determinism, strict-replay divergence detection, fork/promote
conflicts, and the mechanical hexagon check.
