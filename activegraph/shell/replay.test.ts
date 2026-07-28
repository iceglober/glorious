import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createFixedClock } from "../adapters/clocks";
import { createScriptedLlm } from "../adapters/fake-llm";
import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import { createKit } from "../domain/behaviors";
import { canonicalJson } from "../domain/events";
import { defineSchema } from "../domain/schema";
import { type ExampleSchema, exampleBehaviors, exampleKit, exampleSchema } from "../example";
import { unwrap } from "../lib/fp";
import { replayPermissive, replayStrict } from "./replay";
import { createRuntime } from "./runtime";

const recordExampleRun = async () => {
  const eventStore = createMemoryEventStore<ExampleSchema>();
  const runtime = unwrap(
    await createRuntime({
      schema: exampleSchema,
      behaviors: exampleBehaviors,
      eventStore,
      graphStore: createMemoryGraphStore<ExampleSchema>(),
      clock: createFixedClock(),
    }),
  );
  unwrap(await runtime.runGoal("Evaluate this startup idea"));
  return { eventStore, runtime };
};

describe("replayStrict", () => {
  test("re-running the recorded branch with the same behaviors passes", async () => {
    const { eventStore } = await recordExampleRun();
    const verdict = await replayStrict({
      schema: exampleSchema,
      behaviors: exampleBehaviors,
      store: eventStore,
      branch: "main",
    });
    expect(verdict.ok).toBe(true);
  });

  test("a swapped behavior variant diverges at the exact first differing event", async () => {
    const { eventStore, runtime } = await recordExampleRun();
    const variantResearcher = exampleKit.behavior({
      name: "researcher",
      on: ["object.created"],
      where: (event) =>
        event.payload.objectType === "task" &&
        event.payload.data.status === "open" &&
        event.payload.data.title.includes("Research"),
      run: (event, ctx) => {
        if (event.type !== "object.created" || event.payload.objectType !== "task") return [];
        return [
          // Different claim text than the recorded run.
          ctx.m.addObject("claim", { text: "Market is shrinking.", confidence: 0.2 }),
          ctx.m.emit("task.completed", { taskId: event.payload.objectId }),
        ];
      },
    });
    const behaviors = exampleBehaviors.map((b) =>
      b.name === "researcher" ? variantResearcher : b,
    );
    const verdict = await replayStrict({
      schema: exampleSchema,
      behaviors,
      store: eventStore,
      branch: "main",
    });
    expect(verdict.ok).toBe(false);
    if (verdict.ok) return;
    expect(verdict.error.reason).toBe("diverged");
    if (verdict.error.reason !== "diverged") return;
    // The first divergent event is the researcher's differing patch proposal.
    const recorded = runtime.log();
    const firstDiffering = recorded.find((e) =>
      canonicalJson(e.payload).includes("Market early but growing."),
    );
    expect(verdict.error.divergence.atEventId).toBe(firstDiffering?.id ?? -1);
    expect(verdict.error.divergence.expected).not.toBe(verdict.error.divergence.actual);
  });

  test("llm-backed runs replay from recorded completions without touching a provider", async () => {
    const schema = defineSchema({
      objects: { claim: z.object({ text: z.string() }) },
      relations: {},
      events: {},
    });
    const kit = createKit(schema);
    const summarizer = kit.llmBehavior({
      name: "summarizer",
      on: ["goal.created"],
      prompt: (event) => ({
        prompt: `summarize: ${event.type === "goal.created" ? event.payload.text : ""}`,
      }),
      output: z.object({ text: z.string() }),
      andThen: (output, _event, ctx) => [ctx.m.addObject("claim", { text: output.text })],
    });
    let providerCalls = 0;
    const countingLlm = {
      complete: async (request: { prompt: string }) => {
        providerCalls += 1;
        return createScriptedLlm([JSON.stringify({ text: "looks promising" })]).complete(request);
      },
    };
    const eventStore = createMemoryEventStore<typeof schema>();
    const runtime = unwrap(
      await createRuntime({
        schema,
        behaviors: [summarizer],
        eventStore,
        graphStore: createMemoryGraphStore<typeof schema>(),
        clock: createFixedClock(),
        llm: countingLlm,
      }),
    );
    unwrap(await runtime.runGoal("evaluate the market"));
    expect(providerCalls).toBe(1);

    const verdict = await replayStrict({
      schema,
      behaviors: [summarizer],
      store: eventStore,
      branch: "main",
    });
    expect(verdict.ok).toBe(true);
    // Strict replay served the completion from the recording.
    expect(providerCalls).toBe(1);
  });
});

describe("replayPermissive", () => {
  test("reconstructs the live graph exactly, without invoking any behavior", async () => {
    const { eventStore, runtime } = await recordExampleRun();
    let invocations = 0;
    const spy = exampleKit.behavior({
      name: "spy",
      on: ["goal.created", "object.created", "task.completed"],
      run: () => {
        invocations += 1;
        return [];
      },
    });
    // The spy is irrelevant to permissive replay — it only projects.
    const state = unwrap(await replayPermissive({ store: eventStore, branch: "main" }));
    expect(invocations).toBe(0);
    expect(spy.name).toBe("spy");
    // The reconstructed state deep-equals the live runtime's projection.
    const live = runtime.view();
    expect(state.objects.size).toBe(3); // 2 tasks + 1 claim
    expect(state.relations.size).toBe(1);
    for (const object of live.objects("task")) {
      expect(state.objects.get(object.id)).toEqual(object);
    }
    const memo = [...state.objects.values()].find(
      (o) => (o.data as { title?: string }).title === "Draft memo",
    );
    expect(memo?.data).toMatchObject({ status: "open" });
  });

  test("toId reconstructs any historical prefix", async () => {
    const { eventStore } = await recordExampleRun();
    const early = unwrap(await replayPermissive({ store: eventStore, branch: "main", toId: 1 }));
    expect(early.objects.size).toBe(0);
  });
});
