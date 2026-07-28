import { describe, expect, test } from "bun:test";
import { createFixedClock } from "../adapters/clocks";
import { createFakeLlm } from "../adapters/fake-llm";
import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import { canonicalLog } from "../domain/events";
import { unwrap } from "../lib/fp";
import type { LlmPort } from "../ports/llm";
import { createFork, promote } from "../shell/fork";
import { replayStrict } from "../shell/replay";
import { createRuntime, type Runtime } from "../shell/runtime";
import {
  ids,
  type RpaSchema,
  rpaBehaviors,
  rpaKit,
  rpaSchema,
  seedInvoiceWorkflow,
} from "./rpa-repair";

const goodLlm = () =>
  createFakeLlm(() =>
    JSON.stringify({
      rootCause: "Portal nav was renamed; the link now lives under #invoices-nav",
      newSelector: "#invoices-nav a.portal",
      confidence: 0.92,
    }),
  );

const shakyLlm = () =>
  createFakeLlm(() =>
    JSON.stringify({
      rootCause: "Unclear; page may be A/B tested",
      newSelector: "a.portal",
      confidence: 0.4,
    }),
  );

const makeAgent = async (llm: LlmPort) => {
  const eventStore = createMemoryEventStore<RpaSchema>();
  const runtime: Runtime<RpaSchema> = unwrap(
    await createRuntime({
      schema: rpaSchema,
      behaviors: rpaBehaviors,
      eventStore,
      graphStore: createMemoryGraphStore<RpaSchema>(),
      clock: createFixedClock(),
      llm,
    }),
  );
  await unwrap(runtime.propose(seedInvoiceWorkflow(), { actor: "provisioner" }));
  await unwrap(runtime.runUntilIdle());
  return { eventStore, runtime };
};

const reportFailure = (runtime: Runtime<RpaSchema>) =>
  runtime.emit("run.failed", {
    workflowId: ids.workflow,
    stepId: ids.portal,
    error: "NoSuchElementError: #nav .portal-link",
    domSnippet: '<nav id="invoices-nav"><a class="portal">Portal</a></nav>',
  });

describe("the RPA repair agent", () => {
  test("failure → triage → LLM diagnosis → approval-gated selector fix → recovery", async () => {
    const { runtime } = await makeAgent(goodLlm());
    await unwrap(reportFailure(runtime));
    const paused = await unwrap(runtime.runUntilIdle());

    // Triage and diagnosis landed; the repair is parked behind approval.
    const view = runtime.view();
    expect(view.object(ids.workflow)?.data.status).toBe("degraded");
    const incident = view.objects("incident")[0];
    expect(incident?.data.status).toBe("diagnosed");
    expect(incident?.data.rootCause).toContain("#invoices-nav");
    const fix = view.objects("fix")[0];
    expect(fix?.data).toMatchObject({ status: "proposed", confidence: 0.92 });
    // The edge behavior held the downstream step, and only that one.
    expect(view.object(ids.extract)?.data.status).toBe("held");
    expect(view.object(ids.login)?.data.status).toBe("active");
    // Nothing touched the selector yet — robots propose, humans dispose.
    expect(view.object(ids.portal)?.data.selector).toBe("#nav .portal-link");
    expect(paused.pendingApprovals).toHaveLength(1);

    // The operator approves; the parked patch flows through the normal pipeline.
    await unwrap(runtime.grantApproval(paused.pendingApprovals[0] ?? ""));
    const healed = await unwrap(runtime.runUntilIdle());

    const after = runtime.view();
    expect(after.object(ids.portal)?.data.selector).toBe("#invoices-nav a.portal");
    expect(after.object(ids.extract)?.data.status).toBe("active");
    expect(after.objects("incident")[0]?.data.status).toBe("resolved");
    expect(after.objects("fix")[0]?.data.status).toBe("applied");
    expect(after.object(ids.workflow)?.data.status).toBe("healthy");
    expect(healed.pendingApprovals).toHaveLength(0);
    expect(runtime.log().some((e) => (e.type as string) === "run.recovered")).toBe(true);
  });

  test("the whole repair is deterministic — two runs, byte-identical logs", async () => {
    const runOnce = async () => {
      const { runtime } = await makeAgent(goodLlm());
      await unwrap(reportFailure(runtime));
      const paused = await unwrap(runtime.runUntilIdle());
      await unwrap(runtime.grantApproval(paused.pendingApprovals[0] ?? ""));
      await unwrap(runtime.runUntilIdle());
      return runtime.log();
    };
    const [a, b] = [await runOnce(), await runOnce()];
    expect(a.length).toBeGreaterThan(40);
    expect(canonicalLog(a)).toBe(canonicalLog(b));
  });

  test("provenance: the fix traces back to the run.failed report that caused it", async () => {
    const { runtime } = await makeAgent(goodLlm());
    await unwrap(reportFailure(runtime));
    await unwrap(runtime.runUntilIdle());
    const fix = runtime.view().objects("fix")[0];
    if (fix === undefined) throw new Error("fix missing");
    const chain = runtime.view().provenance(fix.id);
    expect(chain[0]?.type).toBe("run.failed" as (typeof chain)[number]["type"]);
    expect(chain.at(-1)?.type).toBe("object.created" as (typeof chain)[number]["type"]);
  });

  test("a shaky diagnosis escalates and quarantines instead of touching the bot", async () => {
    const { runtime } = await makeAgent(shakyLlm());
    await unwrap(reportFailure(runtime));
    const status = await unwrap(runtime.runUntilIdle());

    const view = runtime.view();
    expect(view.objects("fix")[0]?.data.status).toBe("rejected");
    expect(view.objects("incident")[0]?.data.status).toBe("escalated");
    expect(view.object(ids.workflow)?.data.status).toBe("quarantined");
    expect(view.object(ids.portal)?.data.selector).toBe("#nav .portal-link");
    expect(status.pendingApprovals).toHaveLength(0);
  });

  test("an escalated repair can be rehearsed on a fork, then promoted to production", async () => {
    const { runtime: production, eventStore } = await makeAgent(shakyLlm());
    await unwrap(reportFailure(production));
    await unwrap(production.runUntilIdle());
    const head = production.status().headEventId;

    // The operator rehearses a hand-written fix on an isolated fork.
    unwrap(
      await createFork({ store: eventStore, parent: "main", atEventId: head, name: "rehearsal" }),
    );
    const rehearsal: Runtime<RpaSchema> = unwrap(
      await createRuntime({
        schema: rpaSchema,
        behaviors: rpaBehaviors,
        eventStore,
        graphStore: createMemoryGraphStore<RpaSchema>(),
        clock: createFixedClock(),
        branch: "rehearsal",
      }),
    );
    unwrap(
      await rehearsal.propose(
        [rpaKit.m.patchObject("step", ids.portal, { selector: "#invoices-nav a.portal" })],
        { actor: "operator" },
      ),
    );
    await unwrap(rehearsal.runUntilIdle());

    // The fork healed itself (recover fired there); production is untouched.
    expect(rehearsal.view().object(ids.workflow)?.data.status).toBe("healthy");
    expect(production.view().object(ids.workflow)?.data.status).toBe("quarantined");
    expect(production.view().object(ids.portal)?.data.selector).toBe("#nav .portal-link");

    // Rehearsal validated — land the delta on production and let it settle.
    const landed = unwrap(
      await promote({
        schema: rpaSchema,
        store: eventStore,
        fork: "rehearsal",
        parentRuntime: production,
      }),
    );
    expect(landed.rejected).toBe(0);
    await unwrap(production.runUntilIdle());

    const after = production.view();
    expect(after.object(ids.portal)?.data.selector).toBe("#invoices-nav a.portal");
    expect(after.object(ids.workflow)?.data.status).toBe("healthy");
    expect(after.object(ids.extract)?.data.status).toBe("active");
  });

  test("the audit story: strict replay re-derives the log without re-calling the LLM", async () => {
    let providerCalls = 0;
    const counting: LlmPort = {
      complete: async (request) => {
        providerCalls += 1;
        return goodLlm().complete(request);
      },
    };
    const { runtime, eventStore } = await makeAgent(counting);
    await unwrap(reportFailure(runtime));
    const paused = await unwrap(runtime.runUntilIdle());
    await unwrap(runtime.grantApproval(paused.pendingApprovals[0] ?? ""));
    await unwrap(runtime.runUntilIdle());
    expect(providerCalls).toBe(1);

    const verdict = await replayStrict({
      schema: rpaSchema,
      behaviors: rpaBehaviors,
      store: eventStore,
      branch: "main",
    });
    expect(verdict.ok).toBe(true);
    expect(providerCalls).toBe(1); // the recording answered; no provider traffic
  });
});
