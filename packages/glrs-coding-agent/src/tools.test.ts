import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { z } from "zod";
import { docsPath } from "./prompt";
import { loadSkills } from "./skills";
import {
  BUILT_IN_TOOL_NAMES,
  createTools,
  resultSummary,
  setToolGate,
  type ToolEvent,
  wrapTool,
} from "./tools";

const registry = async (): Promise<string[]> => {
  const skills = await loadSkills(process.cwd());
  return Object.keys(createTools("/tmp", () => {}, skills));
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
    const first = createTools("/tmp", (event) => events.push(event), skills);
    const second = createTools("/tmp", (event) => events.push(event), skills);
    const input = { pattern: "*.ts", path: "/tmp" };

    await (first.glob.execute as (i: typeof input, o: unknown) => Promise<string>)(input, {});
    await (second.glob.execute as (i: typeof input, o: unknown) => Promise<string>)(input, {});

    expect(events.filter((event) => event.phase === "start").map((event) => event.id)).toHaveLength(
      2,
    );
    expect(events.filter((event) => event.phase === "start")[0]?.id).not.toBe(
      events.filter((event) => event.phase === "start")[1]?.id,
    );
  });
});

// The system prompt hands the model an absolute path to glrs's own docs and
// tells it to read them. Confining reads to the project root made that
// instruction false everywhere except inside the glrs repo, and the model
// routed around it with `bash cat`. Reads reach the docs; writes never do.
describe("reaching glrs's own docs", () => {
  const call = async (tool: string, input: Record<string, unknown>): Promise<string> => {
    const skills = await loadSkills(process.cwd());
    const tools = createTools("/tmp", () => {}, skills);
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

// The row shows what a call is worth saying about its own result, not the tail
// of it: `432 lines` is what you want from a read, and the last three lines of
// a file are not.
describe("what a call says about its result", () => {
  test("a read reports its size, not its last line", () => {
    const file = Array.from({ length: 432 }, (_, at) => `${at + 1}|code`).join("\n");
    expect(resultSummary("read", file, true)).toBe("432 lines");
  });

  test("one line of anything is its own summary", () => {
    expect(resultSummary("write", "wrote v2/render.ts", true)).toBe("wrote v2/render.ts");
    expect(resultSummary("edit", "applied 2 edit(s) to a.ts", true)).toBe(
      "applied 2 edit(s) to a.ts",
    );
  });

  test("a search counts what it found", () => {
    expect(resultSummary("grep", "a.ts:1:x\nb.ts:2:y", true)).toBe("2 matches");
    expect(resultSummary("glob", "a.ts", true)).toBe("1 file");
  });

  // The count would otherwise be one too many: these lines are prose about the
  // result rather than part of it.
  test("a truncation notice is not counted as a match", () => {
    expect(resultSummary("grep", "a.ts:1:x\n[truncated at 1 matches]", true)).toBe("1 match");
  });

  test("nothing found reads as nothing found, not as zero", () => {
    expect(resultSummary("grep", "No matches.", true)).toBe("No matches");
  });

  test("a command is summarised by how it ended", () => {
    expect(resultSummary("bash", "compiling\nlinking\nBuild succeeded", true)).toBe(
      "Build succeeded",
    );
  });

  // A failed call puts its reason on its own line, so the row saying it too
  // would be saying it twice.
  test("a failure says nothing here", () => {
    expect(resultSummary("bash", "ERROR: no such file", false)).toBe("");
  });

  test("an empty result says nothing rather than guessing", () => {
    expect(resultSummary("bash", "", true)).toBe("");
  });
});

// Reported from a live session: asked to install a global extension, glrs
// wrote it with a python heredoc through `bash` because `write` refused the
// path — while the docs it had just read told it to write exactly there.
describe("glrs's own directories are reachable", () => {
  const call = async (tool: string, input: Record<string, unknown>): Promise<string> => {
    const skills = await loadSkills(process.cwd());
    const tools = createTools("/tmp", () => {}, skills);
    const execute = tools[tool].execute as (i: unknown, c: unknown) => Promise<string>;
    return execute(input, {});
  };

  test("an extension can be written to the personal extensions directory", async () => {
    const target = join(homedir(), ".config", "agents", "extensions", "zz-write-probe.ts");
    const said = await call("write", { path: target, content: "// probe\n" });
    expect(said).not.toContain("path escapes root");
    expect(await Bun.file(target).text()).toBe("// probe\n");
    await rm(target, { force: true });
  });

  test("and read back, which it also could not do", async () => {
    const target = join(homedir(), ".agents", "skills", "zz-read-probe.txt");
    await mkdir(dirname(target), { recursive: true });
    await Bun.write(target, "probe-content");
    const said = await call("read", { path: target });
    // Asserted on the file's content, not on its name. The refusal quotes the
    // path it refused, so a probe file named after the thing being asserted
    // makes toContain() pass on the very error it is there to rule out — which
    // is what this test did until the grant below was narrowed and it kept
    // passing while reading nothing.
    expect(said).not.toStartWith("ERROR:");
    expect(said).toContain("probe-content");
    await rm(target, { force: true });
  });

  // The grant is the resources, not the directories that hold them. A blanket
  // grant on `~/.glrs` reaches anything anyone keeps there, and a checkout is a
  // common thing to keep there — which would let `write` leave the project root
  // into an unrelated repository.
  test("a file loose in an agent directory is not reachable", async () => {
    const target = join(homedir(), ".glrs", "zz-loose-probe.txt");
    expect(await call("write", { path: target, content: "no" })).toContain("path escapes root");
    expect(await call("read", { path: target })).toContain("path escapes root");
  });

  // The widening is exactly those directories and nothing else.
  test("somewhere else under home is still refused", async () => {
    const said = await call("read", { path: join(homedir(), ".ssh", "id_rsa") });
    expect(said).toContain("path escapes root");
  });

  test("and outside home too", async () => {
    expect(await call("read", { path: "/etc/passwd" })).toContain("path escapes root");
  });
});
