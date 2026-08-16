import { describe, expect, test } from "bun:test";
import { loadSkills } from "./skills";
import { BUILT_IN_TOOL_NAMES, createTools, type ToolEvent } from "./tools";

const registry = async (everything: boolean): Promise<string[]> => {
  const skills = await loadSkills(process.cwd());
  return Object.keys(
    createTools(
      "/tmp",
      () => {},
      async () => "",
      skills,
      everything ? async () => "" : undefined,
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

  test("gives separate registries distinct event IDs", async () => {
    const skills = await loadSkills(process.cwd());
    const events: ToolEvent[] = [];
    const first = createTools(
      "/tmp",
      (event) => events.push(event),
      async () => "",
      skills,
    );
    const second = createTools(
      "/tmp",
      (event) => events.push(event),
      async () => "",
      skills,
    );
    const questions = { questions: [{ question: "Continue?", options: ["Yes"] }] };

    await (
      first.ask_user.execute as (input: typeof questions, options: unknown) => Promise<string>
    )(questions, {});
    await (
      second.ask_user.execute as (input: typeof questions, options: unknown) => Promise<string>
    )(questions, {});

    expect(events.filter((event) => event.phase === "start").map((event) => event.id)).toHaveLength(
      2,
    );
    expect(events.filter((event) => event.phase === "start")[0]?.id).not.toBe(
      events.filter((event) => event.phase === "start")[1]?.id,
    );
  });
});
