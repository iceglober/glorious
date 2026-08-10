import { describe, expect, test } from "bun:test";
import { loadSkills } from "./skills";
import { BUILT_IN_TOOL_NAMES, createTools } from "./tools";

const registry = async (everything: boolean): Promise<string[]> => {
  const skills = await loadSkills(process.cwd());
  return Object.keys(
    createTools(
      "/tmp",
      () => {},
      async () => "",
      skills,
      everything ? async () => "" : undefined,
      everything ? async () => ({ decision: "cancelled" }) : undefined,
    ),
  );
};

describe("BUILT_IN_TOOL_NAMES", () => {
  // mcp.ts uses this list to refuse an MCP tool that would shadow a built-in.
  // If it drifts from the real registry, a server silently overrides a built-in.
  test("names every tool the agent can actually be given", async () => {
    for (const name of await registry(true))
      expect(BUILT_IN_TOOL_NAMES as readonly string[]).toContain(name);
  });

  test("names nothing the registry cannot produce", async () => {
    const everything = await registry(true);
    for (const name of BUILT_IN_TOOL_NAMES) expect(everything).toContain(name);
  });

  test("run_subagent is withheld when delegation is not wired", async () => {
    expect(await registry(false)).not.toContain("run_subagent");
  });
});
