import { describe, expect, test } from "bun:test";
import { availableToolSummaries, createTools } from "./tools";

const noSkills = { catalog: "", summaries: [], tool: undefined } as const;

describe("tool summaries", () => {
  test("lists built-in tools and conditional subagents", () => {
    expect(availableToolSummaries(noSkills, true).map((tool) => tool.name)).toEqual([
      "ask_user",
      "bash",
      "read",
      "write",
      "edit",
      "grep",
      "glob",
      "web_fetch",
      "run_subagent",
    ]);
  });

  test("shows one row per tool the agent actually has", async () => {
    const { loadSkills } = await import("./skills");
    const skills = await loadSkills(process.cwd());
    const registry = Object.keys(
      createTools(
        "/tmp",
        () => {},
        async () => "",
        skills,
        async () => "",
      ),
    );
    expect(availableToolSummaries(skills, true)).toHaveLength(registry.length);
  });
});
