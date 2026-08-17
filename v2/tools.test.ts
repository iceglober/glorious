import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { z } from "zod";
import { docsPath } from "./prompt";
import { loadSkills } from "./skills";
import { BUILT_IN_TOOL_NAMES, createTools, setToolGate, type ToolEvent, wrapTool } from "./tools";

const registry = async (): Promise<string[]> => {
  const skills = await loadSkills(process.cwd());
  return Object.keys(
    createTools(
      "/tmp",
      () => {},
      async () => "",
      skills,
    ),
  );
};

describe("BUILT_IN_TOOL_NAMES", () => {
  // mcp.ts uses this list to refuse an MCP tool that would shadow a built-in.
  // If it drifts from the real registry, a server silently overrides a built-in.
  test("names every tool the agent can actually be given", async () => {
    for (const name of await registry())
      expect(BUILT_IN_TOOL_NAMES as readonly string[]).toContain(name);
  });

  test("names nothing the registry cannot produce", async () => {
    const everything = await registry();
    for (const name of BUILT_IN_TOOL_NAMES) expect(everything).toContain(name);
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

// The system prompt hands the model an absolute path to glorious's own docs and
// tells it to read them. Confining reads to the project root made that
// instruction false everywhere except inside the glorious repo, and the model
// routed around it with `bash cat`. Reads reach the docs; writes never do.
describe("reaching glorious's own docs", () => {
  const call = async (tool: string, input: Record<string, unknown>): Promise<string> => {
    const skills = await loadSkills(process.cwd());
    const tools = createTools(
      "/tmp",
      () => {},
      async () => "",
      skills,
    );
    const execute = tools[tool].execute as (i: unknown, c: unknown) => Promise<string>;
    return execute(input, {});
  };

  test("read reaches a doc outside the project root", async () => {
    const said = await call("read", { path: join(docsPath(), "extensions.md") });
    expect(said).not.toStartWith("ERROR:");
    expect(said).toContain("g.z");
  });

  test("read still refuses anywhere else outside the root", async () => {
    expect(await call("read", { path: "/etc/hosts" })).toContain("path escapes root");
  });

  test("write cannot use the docs as a way out of the project", async () => {
    const said = await call("write", {
      path: join(docsPath(), "zz-should-not-exist.md"),
      content: "no",
    });
    expect(said).toContain("path escapes root");
  });
});

// The gate is what makes a read-only mode or a confirm-before-destructive
// guard writable as an extension. It wraps every tool — built-in, bundled and
// third-party alike — because they all go through wrapTool.
describe("the tool gate", () => {
  const run = async (input: Record<string, unknown> = {}): Promise<string> => {
    const tool = wrapTool(
      () => {},
      "probe",
      "d",
      z.object({}),
      async () => "real result",
    );
    const execute = tool.execute as (i: unknown, c: unknown) => Promise<string>;
    return execute(input, {});
  };

  afterEach(() => setToolGate(null));

  test("with no gate the tool runs and its result is untouched", async () => {
    expect(await run()).toBe("real result");
  });

  test("before() refuses the call, and the body never runs", async () => {
    let ran = false;
    setToolGate({
      before: async () => "ERROR: blocked by policy",
      after: async () => undefined,
    });
    const tool = wrapTool(
      () => {},
      "probe",
      "d",
      z.object({}),
      async () => {
        ran = true;
        return "real result";
      },
    );
    const execute = tool.execute as (i: unknown, c: unknown) => Promise<string>;
    expect(await execute({}, {})).toBe("ERROR: blocked by policy");
    expect(ran).toBe(false);
  });

  test("a refusal still emits both phases, so the row is not left running", async () => {
    const events: ToolEvent[] = [];
    setToolGate({ before: async () => "ERROR: no", after: async () => undefined });
    const tool = wrapTool(
      (e) => events.push(e),
      "probe",
      "d",
      z.object({}),
      async () => "x",
    );
    await (tool.execute as (i: unknown, c: unknown) => Promise<string>)({}, {});
    expect(events.map((event) => event.phase)).toEqual(["start", "end"]);
    expect(events.filter((event) => event.phase === "end")).toMatchObject([{ ok: false }]);
  });

  test("after() rewrites what the model is told came back", async () => {
    setToolGate({
      before: async () => undefined,
      after: async (_name, _input, _ok, result) => `${result} [annotated]`,
    });
    expect(await run()).toBe("real result [annotated]");
  });

  test("after() sees whether the call succeeded", async () => {
    let seen: boolean | undefined;
    setToolGate({
      before: async () => undefined,
      after: async (_n, _i, ok) => {
        seen = ok;
        return undefined;
      },
    });
    const tool = wrapTool(
      () => {},
      "probe",
      "d",
      z.object({}),
      async () => "ERROR: nope",
    );
    await (tool.execute as (i: unknown, c: unknown) => Promise<string>)({}, {});
    expect(seen).toBe(false);
  });
});
