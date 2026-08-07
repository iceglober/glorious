import { describe, expect, test } from "bun:test";
import { SUBAGENT_STEP_LIMIT, subagentReport } from "./agent";
import { loadSkills } from "./skills";
import { createTools, nextToolEventId, type ToolEvent } from "./tools";

const skills = await loadSkills(process.cwd());
const noop = () => {};
const ask = async () => "";

const parentTools = (onEvent: (event: ToolEvent) => void = noop) =>
  createTools("/tmp", onEvent, ask, skills, async () => "");

// what agent.ts hands a subagent: no asker, no delegation
const subagentTools = (onEvent: (event: ToolEvent) => void = noop) =>
  createTools("/tmp", onEvent, null, skills);

const run = async (tools: ReturnType<typeof createTools>, name: string, input: unknown) => {
  const execute = tools[name]?.execute as (i: unknown, o: unknown) => Promise<string>;
  return execute(input, {});
};

describe("what a subagent is given", () => {
  test("cannot reach the user, so the prohibition is structural", () => {
    expect(Object.keys(subagentTools())).not.toContain("ask_user");
  });

  test("cannot delegate further", () => {
    expect(Object.keys(subagentTools())).not.toContain("run_subagent");
  });

  test("still has the tools it needs to do the work", () => {
    const names = Object.keys(subagentTools());
    for (const tool of ["bash", "read", "write", "edit", "grep", "glob"])
      expect(names).toContain(tool);
  });

  test("the parent keeps both", () => {
    const names = Object.keys(parentTools());
    expect(names).toContain("ask_user");
    expect(names).toContain("run_subagent");
  });
});

describe("tool event ids", () => {
  // chat.ts pairs start with end by id in one map per turn, while a turn can be
  // running the parent's tools and several subagents' tools at once.
  test("never repeat across separate tool sets", async () => {
    const seen: number[] = [];
    const collect = (event: ToolEvent) => {
      if (event.phase === "start") seen.push(event.id);
    };
    await run(parentTools(collect), "glob", { pattern: "*.nothing" });
    await run(subagentTools(collect), "glob", { pattern: "*.nothing" });
    await run(subagentTools(collect), "glob", { pattern: "*.nothing" });
    expect(seen).toHaveLength(3);
    expect(new Set(seen).size).toBe(3);
  });

  test("advance monotonically, so pairing cannot read a stale entry", () => {
    const first = nextToolEventId();
    const second = nextToolEventId();
    expect(second).toBeGreaterThan(first);
  });

  test("two sibling subagents interleaving still get distinct ids", async () => {
    const seen: number[] = [];
    const collect = (event: ToolEvent) => {
      if (event.phase === "start") seen.push(event.id);
    };
    const a = subagentTools(collect);
    const b = subagentTools(collect);
    await Promise.all([
      run(a, "glob", { pattern: "*.nothing" }),
      run(b, "glob", { pattern: "*.nothing" }),
      run(a, "glob", { pattern: "*.nothing" }),
    ]);
    expect(new Set(seen).size).toBe(seen.length);
  });
});

describe("reporting back", () => {
  test("a real summary is passed through untouched", () => {
    expect(subagentReport("  Renamed the symbol and ran the tests.  ", 4)).toBe(
      "Renamed the symbol and ran the tests.",
    );
  });

  test("silence after exhausting the step budget says so", () => {
    const out = subagentReport("", SUBAGENT_STEP_LIMIT);
    expect(out).toStartWith("ERROR:");
    expect(out).toContain("steps");
  });

  test("silence for any other reason is still reported, not empty", () => {
    const out = subagentReport("   ", 3);
    expect(out).toStartWith("ERROR:");
    expect(out).not.toBe("");
  });

  test("the parent never receives an empty tool result", () => {
    for (const [text, steps] of [
      ["", 0],
      ["", 50],
      ["\n\n", 12],
    ] as const)
      expect(subagentReport(text, steps).trim()).not.toBe("");
  });
});
