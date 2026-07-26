/**
 * A self-healing RPA repair agent on activegraph.
 *
 * The scenario: bots run UI workflows (login → open portal → extract table).
 * When a run fails — usually selector drift after a UI change — the agent:
 *
 *   1. `triage`           files an incident, marks the workflow degraded
 *   2. `haltDownstream`   holds every step downstream of the failure
 *                         (coordination logic ON THE EDGE — relation behavior)
 *   3. `diagnose`         LLM reads the error + DOM snippet + old selector and
 *                         proposes a fix as zod-validated structured output
 *   4. `applyFix`         confident fixes patch the step's selector, GATED
 *                         behind human approval (`requiresApproval`)
 *   5. `escalate`         shaky fixes quarantine the workflow for a human
 *   6. `recover`          once the selector lands, resolve the incident,
 *                         release held steps, heal the workflow, and announce
 *                         `run.recovered`
 *
 * Because everything is an event, the whole repair is auditable
 * (`view.provenance`, `formatTrace`), deterministic (byte-identical logs),
 * replayable without re-calling the LLM, and rehearsable on a fork before
 * `promote` lands it in production.
 */
import { z } from "zod";
import { createKit } from "../domain/behaviors";
import type { AnyBehavior, AnyEvent } from "../index";
import { defineSchema, type Mutation, objectId, pipe, when } from "../index";

export const rpaSchema = defineSchema({
  objects: {
    workflow: z.object({
      name: z.string(),
      status: z.enum(["healthy", "degraded", "quarantined"]),
    }),
    step: z.object({
      name: z.string(),
      kind: z.enum(["click", "type", "extract", "wait"]),
      selector: z.string(),
      status: z.enum(["active", "held"]),
    }),
    incident: z.object({
      error: z.string(),
      domSnippet: z.string(),
      status: z.enum(["open", "diagnosed", "resolved", "escalated"]),
      rootCause: z.string().optional(),
    }),
    fix: z.object({
      description: z.string(),
      newSelector: z.string(),
      confidence: z.number().min(0).max(1),
      status: z.enum(["proposed", "applied", "rejected"]),
    }),
  },
  relations: {
    has_step: { source: "workflow", target: "step" },
    next: { source: "step", target: "step" }, // execution order
    failed_at: { source: "incident", target: "step" },
    repairs: { source: "fix", target: "step" },
    diagnoses: { source: "fix", target: "incident" },
  },
  events: {
    "run.failed": z.object({
      workflowId: z.string(),
      stepId: z.string(),
      error: z.string(),
      domSnippet: z.string(),
    }),
    "run.recovered": z.object({ workflowId: z.string() }),
  },
});
export type RpaSchema = typeof rpaSchema;

export const rpaKit = createKit(rpaSchema);
const CONFIDENCE_FLOOR = 0.75;

/** Deterministic, referenceable ids so later mutations in the same batch can point at them. */
const incidentIdFor = (stepId: string) => objectId<"incident">(`incident_${stepId}`);
const fixIdFor = (stepId: string) => objectId<"fix">(`fix_${stepId}`);

/**
 * 1. triage: a failed run becomes an incident object wired to the failing
 * step, and the workflow is marked degraded. Ids arriving in event payloads
 * are plain strings (they crossed the wire), so they are re-branded with
 * `objectId` — runtime validation still checks they name real objects.
 */
export const triage = rpaKit.behavior({
  name: "triage",
  on: ["run.failed"],
  run: (event, ctx) => {
    const stepId = objectId<"step">(event.payload.stepId);
    const incidentId = incidentIdFor(event.payload.stepId);
    return [
      ctx.m.addObject(
        "incident",
        { error: event.payload.error, domSnippet: event.payload.domSnippet, status: "open" },
        { id: incidentId },
      ),
      ctx.m.addRelation("failed_at", incidentId, stepId),
      ctx.m.patchObject("workflow", objectId<"workflow">(event.payload.workflowId), {
        status: "degraded",
      }),
    ];
  },
});

/**
 * 2. haltDownstream: a relation behavior on the `next` edge — it fires once
 * per execution-order edge whose endpoints the failure references, and holds
 * the downstream step. The bot must not keep typing into a broken page.
 */
export const haltDownstream = rpaKit.relationBehavior({
  name: "haltDownstream",
  relationType: "next",
  on: ["run.failed"],
  run: ({ event, relation, ctx }) =>
    event.type === "run.failed" && event.payload.stepId === relation.source
      ? [ctx.m.patchObject("step", relation.target, { status: "held" })]
      : [],
});

/**
 * 3. diagnose: an LLM behavior. The prompt is built from the incident and the
 * failing step's current selector; the completion must parse against the zod
 * output schema or the behavior fails (a `behavior.failed` event, not a
 * crash). The proposed repair enters the graph as a first-class `fix` object.
 */
export const diagnose = rpaKit.llmBehavior({
  name: "diagnose",
  on: ["object.created"],
  where: (event) => event.payload.objectType === "incident",
  prompt: (event, view) => {
    if (event.type !== "object.created" || event.payload.objectType !== "incident") {
      return { prompt: "" };
    }
    const failedAt = view.relations("failed_at").find((r) => r.source === event.payload.objectId);
    const step = failedAt === undefined ? undefined : view.object(failedAt.target);
    return {
      system:
        "You repair RPA selectors. Given a failed step, its old selector, the error, and a DOM " +
        'snippet, answer JSON: {"rootCause": string, "newSelector": string, "confidence": 0..1}.',
      prompt: [
        `step: ${step?.data.name} (${step?.data.kind})`,
        `old selector: ${step?.data.selector}`,
        `error: ${event.payload.data.error}`,
        `dom: ${event.payload.data.domSnippet}`,
      ].join("\n"),
    };
  },
  output: z.object({
    rootCause: z.string(),
    newSelector: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  andThen: (output, event, ctx) => {
    if (event.type !== "object.created" || event.payload.objectType !== "incident") return [];
    const incidentId = event.payload.objectId;
    const failedAt = ctx.view.relations("failed_at").find((r) => r.source === incidentId);
    if (failedAt === undefined) return [];
    const fixId = fixIdFor(failedAt.target);
    return [
      ctx.m.patchObject("incident", incidentId, {
        status: "diagnosed",
        rootCause: output.rootCause,
      }),
      ctx.m.addObject(
        "fix",
        {
          description: output.rootCause,
          newSelector: output.newSelector,
          confidence: output.confidence,
          status: "proposed",
        },
        { id: fixId },
      ),
      ctx.m.addRelation("repairs", fixId, failedAt.target),
      ctx.m.addRelation("diagnoses", fixId, incidentId),
    ];
  },
});

/** True when the created object is a fix at/above (or below) the confidence floor. */
const fixCreatedWithConfidence =
  (test: (confidence: number) => boolean) =>
  (event: AnyEvent<RpaSchema>): boolean =>
    event.type === "object.created" &&
    event.payload.objectType === "fix" &&
    test(event.payload.data.confidence);

/**
 * 4. applyFix: a confident fix patches the step's selector — but the patch is
 * marked `requiresApproval`, so it parks behind an `approval.proposed` event
 * until an operator calls `runtime.grantApproval(...)`. Robots propose,
 * humans dispose.
 */
export const applyFix = pipe(
  rpaKit.behavior({
    name: "applyFix",
    on: ["object.created"],
    run: (event, ctx) => {
      if (event.type !== "object.created" || event.payload.objectType !== "fix") return [];
      const repairs = ctx.view
        .relations("repairs")
        .find((r) => r.source === event.payload.objectId);
      if (repairs === undefined) return [];
      return [
        ctx.m.patchObject(
          "step",
          repairs.target,
          { selector: event.payload.data.newSelector },
          { requiresApproval: true },
        ),
      ];
    },
  }),
  when(fixCreatedWithConfidence((confidence) => confidence >= CONFIDENCE_FLOOR)),
);

/** 5. escalate: shaky diagnoses quarantine the workflow instead of touching it. */
export const escalate = pipe(
  rpaKit.behavior({
    name: "escalate",
    on: ["object.created"],
    run: (event, ctx) => {
      if (event.type !== "object.created" || event.payload.objectType !== "fix") return [];
      const fixId = event.payload.objectId;
      const diagnoses = ctx.view.relations("diagnoses").find((r) => r.source === fixId);
      const repairs = ctx.view.relations("repairs").find((r) => r.source === fixId);
      const owner =
        repairs === undefined
          ? undefined
          : ctx.view.relations("has_step").find((r) => r.target === repairs.target);
      return [
        ctx.m.patchObject("fix", fixId, { status: "rejected" }),
        ...(diagnoses === undefined
          ? []
          : [ctx.m.patchObject("incident", diagnoses.target, { status: "escalated" })]),
        ...(owner === undefined
          ? []
          : [ctx.m.patchObject("workflow", owner.source, { status: "quarantined" })]),
      ];
    },
  }),
  when(fixCreatedWithConfidence((confidence) => confidence < CONFIDENCE_FLOOR)),
);

/**
 * 6. recover: fires when a step's selector actually changes (whether via the
 * approved fix or a promoted fork rehearsal — both are just events). Resolves
 * the incident, marks the fix applied, releases held steps, heals the
 * workflow, and announces recovery.
 */
export const recover = rpaKit.behavior({
  name: "recover",
  on: ["object.patched"],
  where: (event) => event.payload.objectType === "step" && "selector" in event.payload.patch,
  run: (event, ctx) => {
    if (event.type !== "object.patched" || event.payload.objectType !== "step") return [];
    const stepId = event.payload.objectId;
    const owner = ctx.view.relations("has_step").find((r) => r.target === stepId);
    if (owner === undefined) return [];
    const siblings = ctx.view
      .relations("has_step")
      .filter((r) => r.source === owner.source)
      .map((r) => ctx.view.object(r.target))
      .filter(
        (step): step is NonNullable<typeof step> =>
          step !== undefined && step.data.status === "held",
      );
    const incident = ctx.view.relations("failed_at").find((r) => r.target === stepId);
    const fix = ctx.view
      .relations("repairs")
      .find((r) => r.target === stepId && ctx.view.object(r.source)?.data.status === "proposed");
    return [
      ...(incident === undefined
        ? []
        : [ctx.m.patchObject("incident", incident.source, { status: "resolved" })]),
      ...(fix === undefined ? [] : [ctx.m.patchObject("fix", fix.source, { status: "applied" })]),
      ...siblings.map((step) => ctx.m.patchObject("step", step.id, { status: "active" })),
      ctx.m.patchObject("workflow", owner.source, { status: "healthy" }),
      ctx.m.emit("run.recovered", { workflowId: owner.source }),
    ];
  },
});

export const rpaBehaviors: readonly AnyBehavior<RpaSchema>[] = [
  triage,
  haltDownstream,
  diagnose,
  applyFix,
  escalate,
  recover,
];

/** Provision the demo workflow: login → open portal → extract invoice table. */
export const seedInvoiceWorkflow = (): readonly Mutation<RpaSchema>[] => {
  const m = rpaKit.m;
  const wf = objectId<"workflow">("wf_invoices");
  const login = objectId<"step">("step_login");
  const portal = objectId<"step">("step_portal");
  const extract = objectId<"step">("step_extract");
  return [
    m.addObject("workflow", { name: "Invoice sync", status: "healthy" }, { id: wf }),
    m.addObject(
      "step",
      { name: "Log in", kind: "type", selector: "#username", status: "active" },
      { id: login },
    ),
    m.addObject(
      "step",
      { name: "Open portal", kind: "click", selector: "#nav .portal-link", status: "active" },
      { id: portal },
    ),
    m.addObject(
      "step",
      { name: "Extract table", kind: "extract", selector: "table.invoices", status: "active" },
      { id: extract },
    ),
    m.addRelation("has_step", wf, login),
    m.addRelation("has_step", wf, portal),
    m.addRelation("has_step", wf, extract),
    m.addRelation("next", login, portal),
    m.addRelation("next", portal, extract),
  ];
};

export const ids = {
  workflow: objectId<"workflow">("wf_invoices"),
  login: objectId<"step">("step_login"),
  portal: objectId<"step">("step_portal"),
  extract: objectId<"step">("step_extract"),
} as const;
