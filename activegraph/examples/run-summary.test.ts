import { describe, expect, test } from "bun:test";
import { createFixedClock } from "../adapters/clocks";
import { createFakeLlm } from "../adapters/fake-llm";
import { createMemoryEventStore } from "../adapters/memory-event-store";
import { createMemoryGraphStore } from "../adapters/memory-graph-store";
import type { LlmRequest } from "../domain/effects";
import { unwrap } from "../lib/fp";
import { createRuntime } from "../shell/runtime";
import {
  type CodingAgentSchema,
  codingAgentSchema,
  createCodingAgentBehaviors,
} from "./coding-agent";
import { formatRunSummary, summarizeRun } from "./run-summary";

const config = { model: "planner-model" };
const workspace = { cwd: "/repo", entries: ["README.md"] };
const planJson = JSON.stringify({
  summary: "Do the thing",
  commands: [
    { description: "one", command: "ls" },
    { description: "two", command: "pwd" },
  ],
});
const doneJson = JSON.stringify({ done: true, report: "all good" });
const isReview = (request: LlmRequest): boolean => request.system?.includes("reviewing") === true;

/** Run the agent twice over one log: the second run's planning is cached. */
const twoRuns = async () => {
  const eventStore = createMemoryEventStore<CodingAgentSchema>();
  const graphStore = createMemoryGraphStore<CodingAgentSchema>();
  const llm = createFakeLlm((request) =>
    isReview(request)
      ? doneJson
      : { text: planJson, usage: { inputTokens: 100, outputTokens: 20, reasoningTokens: 5 } },
  );
  const once = async (goal: string) => {
    const runtime = unwrap(
      await createRuntime<CodingAgentSchema>({
        schema: codingAgentSchema,
        behaviors: createCodingAgentBehaviors(),
        eventStore,
        graphStore,
        clock: createFixedClock(),
        llm,
        tools: { execute: async () => ({ ok: true, value: "out" }) },
      }),
    );
    unwrap(await runtime.emit("settings.configured", config));
    unwrap(await runtime.emit("workspace.sampled", workspace));
    unwrap(await runtime.runGoal(goal));
    return runtime;
  };
  await once("Do the thing");
  return await once("Do the thing");
};

describe("run summary", () => {
  test("counts calls, cache hits, commands, and rounds from the log", async () => {
    const runtime = await twoRuns();
    const summary = summarizeRun(runtime.log());

    // Both runs are in the log: two plans and two reviews.
    expect(summary.llmCalls).toBe(4);
    // The second run's identical planning request is served by the log.
    expect(summary.cachedCalls).toBeGreaterThan(0);
    expect(summary.savedChars).toBeGreaterThan(0);
    expect(summary.commands).toBe(4);
    expect(summary.failedCommands).toBe(0);
    expect(summary.rounds).toBe(0);
  });

  test("sums the token usage the provider reported", async () => {
    const runtime = await twoRuns();
    const summary = summarizeRun(runtime.log());

    // Usage rides in the recorded response, so replayed hits count too.
    expect(summary.inputTokens).toBe(200);
    expect(summary.outputTokens).toBe(40);
    expect(summary.reasoningTokens).toBe(10);
  });

  test("says so plainly when the provider reported no usage", () => {
    const summary = summarizeRun([
      {
        id: 1,
        type: "llm.requested",
        payload: { requestId: "r1", requestHash: "h", request: { prompt: "hello" } },
        causedBy: null,
        at: "2026-01-01T00:00:00.000Z",
        branch: "main",
      },
      {
        id: 2,
        type: "llm.responded",
        payload: { requestId: "r1", requestHash: "h", response: { text: "hi" }, cached: false },
        causedBy: null,
        at: "2026-01-01T00:00:00.000Z",
        branch: "main",
      },
    ] as never);

    expect(summary.sentChars).toBe(5);
    expect(formatRunSummary(summary)).toContain("tokens: not reported by the provider");
    expect(formatRunSummary(summary)).toContain("1 llm call(s) over 1 round(s)");
  });
});
