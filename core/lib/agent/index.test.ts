import { describe, expect, mock, test } from "bun:test";
import type { Sandbox } from "../sandbox";
import type { AgentConfig, CreateAgentOptions, ToolActivity } from ".";

type SdkAgentOptions = Record<string, unknown>;

const constructedAgents: SdkAgentOptions[] = [];
const generateCalls: Record<string, unknown>[] = [];

/** Stands in for the SDK's tool loop: records what the adapter built, never
 *  calls a model. Installed before importing the agent module so the runtime
 *  underneath createAgent() is inert. */
class FakeToolLoopAgent {
  constructor(options: SdkAgentOptions) {
    constructedAgents.push(options);
  }

  async generate(options: Record<string, unknown>) {
    generateCalls.push(options);
    return {
      text: "done",
      steps: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      response: { messages: [{ role: "assistant", content: "done" }] },
    };
  }
}

mock.module("ai", () => ({
  ToolLoopAgent: FakeToolLoopAgent,
  jsonSchema: (schema: unknown) => ({ schema }),
  stepCountIs: (count: number) => ({ count }),
  tool: <T>(definition: T) => definition,
}));

const { agentConfigSchema, createAgent, createAgentTools } = await import(".");

const sandboxReading = (content: string): Sandbox => ({
  async executeCommand() {
    return { stdout: "", stderr: "", exitCode: 0 };
  },
  async readFile() {
    return content;
  },
  async writeFiles() {},
});

const sandbox = sandboxReading("");

const baseOptions: CreateAgentOptions = {
  root: "/repo",
  ctx: {
    cwd: "/repo",
    os: "test",
    date: "2026-07-14",
    gitBranch: "main",
    gitStatusSummary: "clean",
  },
};

// Credentials are env-only; a test key keeps model construction offline.
process.env.AZURE_API_KEY ??= "test-key";

/** A parsed config that can build a model without touching the network. */
const config = (over: Record<string, unknown> = {}): AgentConfig => agentConfigSchema.parse(over);

const reset = () => {
  constructedAgents.length = 0;
  generateCalls.length = 0;
};

describe("agentConfigSchema", () => {
  test("`{}` is a complete agent: identity, ceilings, model, prompt, tools", () => {
    const parsed = agentConfigSchema.parse({});
    expect(parsed.name).toBe("glorious");
    expect(parsed.rules).toBe("");
    // Well above the SDK's implicit 20-step default, which silently truncated
    // long turns.
    expect(parsed.steps).toBe(100);
    expect(parsed.llm.model).toBe("gpt-5.6-luna");
    expect(parsed.prompt.profile).toBe("auto");
    expect(parsed.tools.maxOutputChars).toBe(30_000);
    expect(parsed.tools.edit.mode).toBe("batch");
  });

  test("ceilings and caps stay inside their sane ranges", () => {
    expect(agentConfigSchema.parse({ steps: 250 }).steps).toBe(250);
    expect(agentConfigSchema.safeParse({ steps: 0 }).success).toBe(false);
    expect(agentConfigSchema.safeParse({ tools: { maxOutputChars: 100 } }).success).toBe(false);
    expect(agentConfigSchema.safeParse({ tools: { edit: { mode: "typo" } } }).success).toBe(false);
    expect(agentConfigSchema.parse({ tools: { edit: { mode: "hash" } } }).tools.edit.mode).toBe(
      "hash",
    );
  });
});

describe("createAgentTools", () => {
  test("every agent gets the one toolset: shell, read, search, edit", async () => {
    const tools = await createAgentTools(sandbox, agentConfigSchema.parse({}), baseOptions);
    expect(Object.keys(tools).sort()).toEqual([
      "bash",
      "edit",
      "glob",
      "grep",
      "readFile",
      "writeFile",
    ]);
  });

  test("the edit mode swaps the edit tool's input shape, nothing else", async () => {
    const batch = await createAgentTools(sandbox, agentConfigSchema.parse({}), baseOptions);
    const exact = await createAgentTools(
      sandbox,
      agentConfigSchema.parse({ tools: { edit: { mode: "exact" } } }),
      baseOptions,
    );
    expect(Object.keys(exact).sort()).toEqual(Object.keys(batch).sort());

    const batchInput = { path: "a.ts", edits: [{ old_string: "x", new_string: "y" }] };
    const exactInput = { path: "a.ts", old_string: "x", new_string: "y" };
    expect(batch.edit.inputSchema.safeParse(batchInput).success).toBe(true);
    expect(batch.edit.inputSchema.safeParse(exactInput).success).toBe(false);
    expect(exact.edit.inputSchema.safeParse(exactInput).success).toBe(true);
    expect(exact.edit.inputSchema.safeParse(batchInput).success).toBe(false);
  });

  test("tool activity brackets each call with an id shared by its start and end", async () => {
    const events: ToolActivity[] = [];
    const tools = await createAgentTools(sandbox, agentConfigSchema.parse({}), {
      ...baseOptions,
      onToolActivity: (activity) => events.push(activity),
    });

    await tools.readFile.execute({ path: "/repo/a.ts" });
    await tools.readFile.execute({ path: "/repo/b.ts" });

    expect(events.map((e) => `${e.phase}:${e.tool}:${e.detail}`)).toEqual([
      "start:readFile:/repo/a.ts",
      "end:readFile:/repo/a.ts",
      "start:readFile:/repo/b.ts",
      "end:readFile:/repo/b.ts",
    ]);
    // Parallel calls to the same tool are told apart by the minted id, which
    // also rides along in execute options as `activityId`.
    expect(events.map((e) => e.id)).toEqual([1, 1, 2, 2]);
  });

  test("the end event still fires when the call fails", async () => {
    const events: string[] = [];
    const tools = await createAgentTools(
      { ...sandbox, readFile: async () => Promise.reject(new Error("gone")) },
      agentConfigSchema.parse({}),
      { ...baseOptions, onToolActivity: (a) => events.push(`${a.phase}:${a.tool}`) },
    );

    const result = await tools.readFile.execute({ path: "/repo/a.ts" });
    expect(String(result)).toContain("ERROR: gone");
    // A failed call must not leave a UI showing the tool as still running.
    expect(events).toEqual(["start:readFile", "end:readFile"]);
  });

  test("without an activity callback the tools are handed over unwrapped", async () => {
    const tools = await createAgentTools(sandbox, agentConfigSchema.parse({}), baseOptions);
    await expect(tools.readFile.execute({ path: "/repo/a.ts" })).resolves.toBeDefined();
  });
});

describe("createAgent", () => {
  test("composes the prompt for the configured model and sends it as instructions", async () => {
    reset();
    const agent = await createAgent(
      sandbox,
      config({ llm: { model: "gpt-5.6-luna" } }),
      baseOptions,
    );
    expect(agent.composed.profile).toBe("gpt-5.6-luna");

    await agent.generate("fix the build");

    expect(constructedAgents[0]?.instructions).toBe(agent.composed.instructions);
    expect(generateCalls[0]?.prompt).toBe("fix the build");
    // The whole toolset is offered, in the stable sorted order.
    expect(constructedAgents[0]?.toolOrder).toEqual([
      "bash",
      "edit",
      "glob",
      "grep",
      "readFile",
      "writeFile",
    ]);
  });

  test("explicit call settings beat the profile's recommendation", async () => {
    reset();
    // The deepseek profile advises temperature/topP 1.0.
    const advised = await createAgent(
      sandbox,
      config({ llm: { model: "deepseek-v4-pro" } }),
      baseOptions,
    );
    await advised.generate("hi");
    expect(constructedAgents.at(-1)).toMatchObject({ temperature: 1, topP: 1 });

    const pinned = await createAgent(
      sandbox,
      config({ llm: { model: "deepseek-v4-pro", temperature: 0.2, topP: 0.5 } }),
      baseOptions,
    );
    await pinned.generate("hi");
    expect(constructedAgents.at(-1)).toMatchObject({ temperature: 0.2, topP: 0.5 });
  });

  test("the profile's provider options ride along with every turn", async () => {
    reset();
    const agent = await createAgent(
      sandbox,
      config({ llm: { model: "gpt-5.6-luna" } }),
      baseOptions,
    );
    await agent.generate("hi");
    expect(constructedAgents[0]?.providerOptions).toEqual({
      openai: { reasoningEffort: "medium", textVerbosity: "low" },
    });
  });

  test("the caller's stopSteps overrides the config's per-turn ceiling", async () => {
    reset();
    const stepped = config({ steps: 42 });
    const capped = await createAgent(sandbox, stepped, { ...baseOptions, stopSteps: 3 });
    await capped.generate("hi");
    expect(constructedAgents.at(-1)?.stopWhen).toEqual([{ count: 3 }]);

    const uncapped = await createAgent(sandbox, stepped, baseOptions);
    await uncapped.generate("hi");
    expect(constructedAgents.at(-1)?.stopWhen).toEqual([{ count: 42 }]);
  });

  test("prior turns are sent back with the new prompt appended", async () => {
    reset();
    const agent = await createAgent(sandbox, config(), baseOptions);
    const history = [{ role: "user", content: "earlier" }];

    const result = await agent.generate("next", { messages: history });

    expect(generateCalls[0]?.messages).toEqual([...history, { role: "user", content: "next" }]);
    expect(result.messages).toEqual([
      ...history,
      { role: "user", content: "next" },
      { role: "assistant", content: "done" },
    ]);
  });

  test("the tool-output cap and the session spill store reach the tools", async () => {
    reset();
    const spilled: string[] = [];
    const agent = await createAgent(
      sandboxReading("x".repeat(5_000)),
      config({ tools: { maxOutputChars: 1_000 } }),
      {
        ...baseOptions,
        spill: {
          dir: "/spill",
          write: (label, value) => {
            spilled.push(`${label}:${value.length}`);
            return "/spill/full.txt";
          },
        },
      },
    );
    await agent.generate("hi");

    const tools = constructedAgents[0]?.tools as Record<
      string,
      { execute: (input: unknown) => Promise<unknown> }
    >;
    const out = (await tools.readFile.execute({ path: "/repo/big.ts" })) as string;
    expect(out.length).toBeLessThanOrEqual(1_000);
    expect(out).toContain("/spill/full.txt");
    // 5002 = the file's 5,000 chars plus the read tool's `1|` line prefix.
    expect(spilled).toEqual(["tool-output:5002"]);
  });

  test("exposes a continuation compactor that folds old turns into a summary", async () => {
    const agent = await createAgent(sandbox, config(), baseOptions);
    const history = Array.from({ length: 8 }, (_, i) => ({ role: "user", content: `turn ${i}` }));

    const compacted = agent.compactContinuation?.(history) ?? [];

    expect(compacted.length).toBeLessThan(history.length);
    expect((compacted[0] as { content: string }).content).toContain(
      "Compacted earlier conversation",
    );
    // Recent turns survive verbatim.
    expect(compacted.at(-1)).toEqual({ role: "user", content: "turn 7" });
  });
});
