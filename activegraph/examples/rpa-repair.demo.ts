/**
 * Runnable narrated demo of the RPA repair agent. Run it with:
 *
 *     bun activegraph/examples/rpa-repair.demo.ts
 *
 * It provisions a workflow, feeds in a bot failure, shows the event trace the
 * runtime appends at each phase, prints an operator-style dashboard between
 * phases, approves the repair, and finishes with the provenance chain and a
 * strict-replay audit. The LLM is a deterministic fake so the demo runs
 * offline; swap `llm` for any `LlmPort` implementation to use a real model.
 */
import { createLogicalClock } from "../adapters/clocks";
import { createFakeLlm } from "../adapters/fake-llm";
import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import { unwrap } from "../lib/fp";
import { replayStrict } from "../shell/replay";
import { createRuntime, type Runtime } from "../shell/runtime";
import { formatEvent } from "../shell/trace";
import { ids, type RpaSchema, rpaBehaviors, rpaSchema, seedInvoiceWorkflow } from "./rpa-repair";

// ── wiring ──────────────────────────────────────────────────────────────────
// In production this fake is replaced by a real LlmPort (one method:
// complete(request) -> { text }). Everything else stays identical.
const llm = createFakeLlm(() =>
  JSON.stringify({
    rootCause: "Portal nav was renamed in last night's deploy; the link moved under #invoices-nav",
    newSelector: "#invoices-nav a.portal",
    confidence: 0.92,
  }),
);

const eventStore = createMemoryEventStore<RpaSchema>();
let traceBuffer: string[] = [];
const runtime: Runtime<RpaSchema> = await unwrap(
  createRuntime({
    schema: rpaSchema,
    behaviors: rpaBehaviors,
    eventStore,
    graphStore: createMemoryGraphStore<RpaSchema>(),
    clock: createLogicalClock({ tickSeconds: 1 }),
    llm,
    tracer: { onEvent: (event) => traceBuffer.push(formatEvent(event)) },
  }),
);

const phase = (title: string) => {
  console.log(`\n═══ ${title} ${"═".repeat(Math.max(0, 66 - title.length))}`);
  traceBuffer = [];
};
const showTrace = (label: string) => {
  console.log(`\n  events appended (${traceBuffer.length}) — ${label}:`);
  for (const line of traceBuffer) console.log(`    ${line}`);
};
const dashboard = () => {
  const view = runtime.view();
  const status = runtime.status();
  const wf = view.object(ids.workflow);
  console.log(`\n  ┌─ dashboard ─────────────────────────────────────────────`);
  console.log(`  │ workflow  "${wf?.data.name}"  status=${wf?.data.status}`);
  for (const step of view.objects("step")) {
    console.log(
      `  │   step ${String(step.id).padEnd(13)} ${step.data.status.padEnd(6)} selector=${step.data.selector}`,
    );
  }
  for (const incident of view.objects("incident")) {
    console.log(
      `  │ incident  ${incident.data.status}  rootCause=${incident.data.rootCause ?? "—"}`,
    );
  }
  for (const fix of view.objects("fix")) {
    console.log(
      `  │ fix       ${fix.data.status}  confidence=${fix.data.confidence}  newSelector=${fix.data.newSelector}`,
    );
  }
  console.log(
    `  │ runtime   head=#${status.headEventId}  processed=${status.processed}  pendingApprovals=[${status.pendingApprovals.join(", ")}]`,
  );
  console.log(`  └─────────────────────────────────────────────────────────`);
};

// ── phase 0: provision the workflow ─────────────────────────────────────────
phase("PHASE 0 — provision the invoice workflow");
await unwrap(runtime.propose(seedInvoiceWorkflow(), { actor: "provisioner" }));
await unwrap(runtime.runUntilIdle());
showTrace("seeding: 4 objects + 5 relations, then the queue drains to idle");
dashboard();

// ── phase 1: a bot reports a failure ────────────────────────────────────────
phase("PHASE 1 — a bot run fails (selector drift)");
await unwrap(
  runtime.emit("run.failed", {
    workflowId: ids.workflow,
    stepId: ids.portal,
    error: "NoSuchElementError: #nav .portal-link",
    domSnippet: '<nav id="invoices-nav"><a class="portal">Portal</a></nav>',
  }),
);
const paused = await unwrap(runtime.runUntilIdle());
showTrace("triage → hold downstream → LLM diagnosis → fix parked for approval");
dashboard();

// ── phase 2: the operator approves the repair ───────────────────────────────
phase("PHASE 2 — operator approves the proposed fix");
console.log(
  `\n  operator reviews fix, then: runtime.grantApproval("${paused.pendingApprovals[0]}")`,
);
await unwrap(runtime.grantApproval(paused.pendingApprovals[0] ?? ""));
await unwrap(runtime.runUntilIdle());
showTrace("released patch → selector updated → recovery cascade");
dashboard();

// ── phase 3: audit ──────────────────────────────────────────────────────────
phase("PHASE 3 — audit: provenance and strict replay");
const fix = runtime.view().objects("fix")[0];
if (fix !== undefined) {
  console.log(`\n  provenance of ${fix.id} (how did this object come to exist?):`);
  for (const event of runtime.view().provenance(fix.id)) {
    console.log(`    ${formatEvent(event)}`);
  }
}
const verdict = await replayStrict({
  schema: rpaSchema,
  behaviors: rpaBehaviors,
  store: eventStore,
  branch: "main",
});
console.log(
  `\n  strict replay of the whole run: ${verdict.ok ? "PASS — log re-derived byte-for-byte, zero LLM calls" : "DIVERGED"}`,
);
console.log(`  total events in log: ${runtime.log().length}\n`);
