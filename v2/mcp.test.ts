import { afterAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startMcp } from "./mcp";
import { navigationPrompt } from "./prompt";
import { BUILT_IN_TOOL_NAMES, createTools, type ToolEvent } from "./tools";

const dir = await mkdtemp(join(tmpdir(), "glorious-mcp-"));

// a stdio MCP server: newline-delimited JSON-RPC, offering one symbol tool,
// one tool that collides with a built-in, and one that is never allowlisted.
const server = join(dir, "server.ts");
await writeFile(
  server,
  `const reply = (value: unknown) => { process.stdout.write(JSON.stringify(value) + "\\n"); };
const tools = [
  { name: "find_symbol", description: "Find a symbol by name path.\\nSecond line.", inputSchema: { type: "object", properties: { name_path: { type: "string" } }, required: ["name_path"] } },
  { name: "bash", description: "A shell that must lose to the built-in.", inputSchema: { type: "object", properties: {} } },
  { name: "noisy_extra", description: "Never allowlisted.", inputSchema: { type: "object", properties: {} } },
];
let buffer = "";
process.stdin.on("data", (chunk) => {
  buffer += chunk.toString();
  let at;
  while ((at = buffer.indexOf("\\n")) >= 0) {
    const line = buffer.slice(0, at).trim();
    buffer = buffer.slice(at + 1);
    if (!line) continue;
    const message = JSON.parse(line);
    if (message.method === "initialize") reply({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1" } } });
    if (message.method === "tools/list") reply({ jsonrpc: "2.0", id: message.id, result: { tools } });
    if (message.method === "tools/call") {
      if (message.params.name === "find_symbol" && message.params.arguments.name_path === "boom")
        reply({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "no such symbol" }], isError: true } });
      else
        reply({ jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "called " + message.params.name + " with " + JSON.stringify(message.params.arguments) }] } });
    }
  }
});
`,
);
await chmod(server, 0o755);

const events: ToolEvent[] = [];
const session = await startMcp(dir, {
  fake: { command: "bun", args: [server], tools: ["find_symbol", "bash", "absent_tool"] },
  off: { command: "bun", args: [server], disabled: true },
});
const tools = session.toolsFor((event) => events.push(event));

afterAll(async () => {
  session.close();
  await rm(dir, { recursive: true, force: true });
});

const call = async (name: string, input: Record<string, unknown>): Promise<string> => {
  const execute = tools[name]?.execute as (
    input: Record<string, unknown>,
    options: unknown,
  ) => Promise<string>;
  return execute(input, {});
};

test("does not spawn an unapproved project server", async () => {
  const blocked = await startMcp(dir, {
    blocked: {
      config: { command: "this-command-must-never-run" },
      source: "project",
      approved: false,
      fingerprint: "changed",
    },
  });
  expect(blocked.servers).toEqual([
    { name: "blocked", tools: 0, source: "project", status: "unapproved", fingerprint: "changed" },
  ]);
  blocked.close();
});

describe("connecting", () => {
  test("adopts an allowlisted tool from the server", () => {
    expect(Object.keys(tools)).toContain("find_symbol");
  });

  test("admits only what the allowlist names", () => {
    expect(Object.keys(tools)).not.toContain("noisy_extra");
  });

  test("a built-in always wins a name collision", () => {
    expect(tools.bash).toBeUndefined();
    expect(session.notes.join(" ")).toContain("shadowed by a built-in");
  });

  test("reports an allowlisted tool the server never offered", () => {
    expect(session.notes.join(" ")).toContain("absent_tool");
  });

  test("skips a disabled server without spawning it", () => {
    expect(session.summaries.every((entry) => entry.server === "fake")).toBe(true);
  });
});

describe("calling", () => {
  test("round-trips arguments and returns the text content", async () => {
    const out = await call("find_symbol", { name_path: "createChat" });
    expect(out).toContain("called find_symbol");
    expect(out).toContain("createChat");
  });

  test("an isError result comes back as an ERROR string, not a throw", async () => {
    expect(await call("find_symbol", { name_path: "boom" })).toBe("ERROR: no such symbol");
  });

  test("announces start and end so the call renders in the transcript", async () => {
    events.length = 0;
    await call("find_symbol", { name_path: "createAgent" });
    expect(events.map((event) => event.phase)).toEqual(["start", "end"]);
    expect(events[0].name).toBe("find_symbol");
    expect(events[0].detail).toBe("createAgent");
  });

  test("its event ids cannot collide with built-in tool ids", async () => {
    // Both draw from one process-wide counter now, so this holds by
    // construction rather than by MCP starting at a high offset.
    events.length = 0;
    const builtIn: number[] = [];
    const tools = createTools(
      "/tmp",
      (event) => {
        if (event.phase === "start") builtIn.push(event.id);
      },
      null,
      { catalog: "", commands: [], summaries: [], tool: undefined },
    );
    const glob = tools.glob?.execute as (i: unknown, o: unknown) => Promise<string>;
    await glob({ pattern: "*.nothing" }, {});
    await call("find_symbol", { name_path: "x" });
    expect(builtIn).toHaveLength(1);
    expect(events[0].id).not.toBe(builtIn[0]);
  });
});

describe("cache stability", () => {
  test("tool order is deterministic, so the payload is byte-stable", () => {
    expect(Object.keys(tools)).toEqual([...Object.keys(tools)].sort());
  });

  test("no adopted tool shadows a built-in", () => {
    for (const name of Object.keys(tools))
      expect(BUILT_IN_TOOL_NAMES as readonly string[]).not.toContain(name);
  });
});

describe("adoption guidance", () => {
  test("is empty when no semantic tools are connected", () => {
    expect(navigationPrompt([])).toBe("");
  });

  test("names the tools and states the boundary the evaluation found", () => {
    const block = navigationPrompt(session.summaries);
    expect(block).toContain("find_symbol");
    expect(block).toContain("edit");
    expect(block).toContain("symbol");
  });

  test("collapses a multi-line tool description to one line", () => {
    expect(navigationPrompt(session.summaries)).not.toContain("Second line.");
  });
});
