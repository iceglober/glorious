import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Capture,
  createApi,
  createRegistry,
  describeContribution,
  type ExtensionHost,
  fire,
  type Registry,
  resetRegistry,
} from "./extension-api";
import { loadExtensions } from "./extensions";
import { runShell, type ToolEvent } from "./tools";

let root = "";
const captured: Capture[] = [];
const printed: string[] = [];
const sent: string[] = [];
const stored: Array<{ type: string; data: unknown }> = [];

const host: ExtensionHost = {
  get root() {
    return root;
  },
  exec: async (command) => ({
    output: `ran ${command}`,
    stdout: `ran ${command}`,
    stderr: "",
    code: 0,
    ok: true,
  }),
  send: (text) => {
    sent.push(text);
  },
  print: (content) => {
    printed.push(
      typeof content === "string"
        ? content
        : content.map((line) => line.map((span) => span.text).join("")).join("\n"),
    );
  },
  capture: (spec) => {
    captured.push(spec);
    return { close: () => {}, repaint: () => {} };
  },
  inspect: () => ({ commands: [], skills: [], extensions: [] }),
  clear: () => "cleared" as const,
  compact: async () => ({ outcome: "too-short" as const }),
  reload: async () => {},
  mode: "tui" as const,
  setInput: () => {},
  columns: () => 100,
  tools: () => ["read", "write"],
  setToolFilters: () => {},
  model: () => ({ label: "azure/test", provider: "azure", modelId: "test" }),
  models: async () => [],
  setModel: async () => {},
  idle: () => true,
  pending: () => 0,
  abort: () => false,
  usage: () => ({ tokens: null, total: { input: 0, output: 0, cached: 0, cost: 0, steps: 0 } }),
  systemPrompt: () => "prompt",
  shutdown: () => {},
  session: () => ({ id: "test", file: "/tmp/test.json", title: "test", events: 0 }),
  setSessionName: () => {},
  appendEntry: (type, data) => {
    stored.push({ type, data });
  },
  entries: (type) => stored.filter((one) => one.type === type).map((one) => one.data),
};

const write = async (name: string, source: string): Promise<void> => {
  await writeFile(join(root, ".glorious", "extensions", name), source);
};

const load = async (): Promise<{ registry: Registry; events: ToolEvent[]; result: unknown }> => {
  const registry = createRegistry();
  const events: ToolEvent[] = [];
  const result = await loadExtensions(root, registry, host, (event) => events.push(event));
  return { registry, events, result };
};

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "glorious-extensions-"));
  await mkdir(join(root, ".glorious", "extensions"), { recursive: true });
  await mkdir(join(root, ".glorious", "extensions", "sized"), { recursive: true });

  // No imports at all — g.z is why. An extension that had to resolve zod would
  // work in a project and fail from ~/.config, which is not a working extension.
  await write(
    "greeter.ts",
    `export default function (g) {
  g.tool({
    name: "greet",
    description: "Greet someone",
    input: g.z.object({ who: g.z.string() }),
    execute: ({ who }) => \`hello \${who}\`,
    renderCall: ({ who }) => [[{ text: "waving at " + who }]],
  });
  g.tool({
    name: "detonate",
    description: "Always throws",
    input: g.z.object({}),
    execute: () => { throw new Error("detonated"); },
  });
  g.command("wave", { description: "Wave", run: (args) => g.print("wave " + args) });
  g.on("input", ({ text }) => (text === "swallow me" ? false : undefined));
  g.on("input", ({ text }) => (text === "rewrite me" ? "rewritten" : undefined));
  g.status(() => "greeting");
  g.prompt("A greet tool is available.");
}
`,
  );
  await write("broken.ts", "export default function () { throw new Error('boom'); }\n");
  await write("notafunction.ts", "export default 42;\n");
  await writeFile(
    join(root, ".glorious", "extensions", "sized", "index.ts"),
    "export default function (g) { g.command('sized', { description: 'd', run: () => {} }); }\n",
  );
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("loading extensions", () => {
  test("a single file and a directory are both one extension", async () => {
    const { result } = await load();
    const names = (result as { extensions: Array<{ name: string }> }).extensions.map((e) => e.name);
    expect(names).toContain("greeter");
    expect(names).toContain("sized");
  });

  // An extension is third-party code in a process that owns the terminal. One
  // that throws must cost only itself, or a stale file in ~/.config takes every
  // project with it.
  test("one that throws is reported, and the others still load", async () => {
    const { result } = await load();
    const { extensions, failures } = result as {
      extensions: Array<{ name: string }>;
      failures: Array<{ origin: string; message: string }>;
    };
    expect(failures.map((f) => f.message)).toContain("boom");
    expect(extensions.map((e) => e.name)).toContain("greeter");
  });

  test("a default export that is not a function is a failure, not a silent skip", async () => {
    const { result } = await load();
    const { failures } = result as { failures: Array<{ message: string }> };
    expect(failures.some((f) => f.message.includes("no default export"))).toBe(true);
  });
});

describe("what an extension can register", () => {
  test("a tool the model can call", async () => {
    const { registry, events } = await load();
    expect(Object.keys(registry.tools)).toContain("greet");
    const execute = registry.tools.greet.execute as (
      input: unknown,
      call: unknown,
    ) => Promise<string>;
    expect(await execute({ who: "world" }, {})).toBe("hello world");
    // the same event stream the built-ins use, which is what paints the row
    expect(events.map((event) => event.phase)).toEqual(["start", "end"]);
  });

  // The same wrapper the built-ins use. A throw becomes text the model can read
  // and recover from, rather than an exception escaping into the turn loop.
  test("a tool that throws becomes an ERROR the model can read, not a dead turn", async () => {
    const { registry, events } = await load();
    const execute = registry.tools.detonate.execute as (
      input: unknown,
      call: unknown,
    ) => Promise<string>;
    expect(await execute({}, {})).toBe("ERROR: detonated");
    expect(events.filter((event) => event.phase === "end")).toMatchObject([{ ok: false }]);
  });

  test("a slash command that runs its own code", async () => {
    const { registry } = await load();
    expect(registry.commands.map((command) => command.name)).toContain("wave");
    printed.length = 0;
    await registry.runners.get("wave")?.("there");
    expect(printed).toEqual(["wave there"]);
  });

  test("a status segment and a preamble line", async () => {
    const { registry } = await load();
    expect(registry.statuses.map((render) => render())).toContain("greeting");
    expect(registry.promptLines).toContain("A greet tool is available.");
  });

  test("a renderer, keyed by the tool it draws", async () => {
    const { registry } = await load();
    expect(registry.renderers.get("greet")?.call?.({ who: "you" })).toEqual([
      [{ text: "waving at you" }],
    ]);
  });

  test("/extensions can say what each one did", async () => {
    const { registry } = await load();
    const said = describeContribution(
      registry,
      join(root, ".glorious", "extensions", "greeter.ts"),
    );
    expect(said).toContain("tools: greet");
    expect(said).toContain("commands: /wave");
    expect(said).toContain("2 hooks");
  });
});

describe("firing an event", () => {
  test("false from a handler swallows the input", async () => {
    const { registry } = await load();
    expect(await fire(registry, "input", { text: "swallow me" }, () => {})).toBe(false);
  });

  test("a string from a handler replaces the text", async () => {
    const { registry } = await load();
    expect(await fire(registry, "input", { text: "rewrite me" }, () => {})).toBe("rewritten");
  });

  test("returning nothing leaves the text alone", async () => {
    const { registry } = await load();
    expect(await fire(registry, "input", { text: "as typed" }, () => {})).toBeUndefined();
  });

  // A handler is third-party code on the path of every turn. It reports and the
  // turn continues; the alternative is one bad extension bricking the session.
  test("a handler that throws is reported and does not stop the turn", async () => {
    const registry = createRegistry();
    registry.handlers.set("input", [
      () => {
        throw new Error("nope");
      },
      () => "survived",
    ]);
    const failures: string[] = [];
    const said = await fire(registry, "input", { text: "x" }, (m) => failures.push(m));
    expect(failures[0]).toContain("nope");
    expect(said).toBe("survived");
  });
});

// Four places where an extension author wrote something reasonable and got a
// wrong answer.
describe("the API keeps its promises", () => {
  const api = () => {
    const registry = createRegistry();
    return { registry, g: createApi(host, registry, () => {}, "test") };
  };

  // ok collapsed every failure into one bit: exit 1 (the linter found problems)
  // and exit 127 (the linter is not installed) are opposite situations.
  test("exec reports the exit code and stderr, not just a boolean", async () => {
    const result = await runShell(process.cwd(), "echo out; echo err >&2; exit 3");
    expect(result).toMatchObject({ code: 3, ok: false });
    expect(result.stdout.trim()).toBe("out");
    expect(result.stderr.trim()).toBe("err");
    expect(result.output).toContain("out");
    expect(result.output).toContain("err");
  });

  test("shell output streams before a long-running command exits", async () => {
    const chunks: string[] = [];
    const running = runShell(
      process.cwd(),
      "printf 'ready\\n'; sleep 0.3; printf 'done\\n'",
      [],
      (text) => chunks.push(text),
    );
    await Bun.sleep(100);
    expect(chunks.join("")).toContain("ready");
    expect(chunks.join("")).not.toContain("done");
    expect((await running).stdout).toContain("done");
  });

  test("a command that works reports zero", async () => {
    expect(await runShell(process.cwd(), "true")).toMatchObject({ code: 0, ok: true });
  });

  // It was one global list, last writer wins: the second extension to restrict
  // silently undid the first.
  test("tool filters compose rather than clobber", () => {
    const { g } = api();
    const seen: string[][] = [];
    const recording = {
      ...host,
      setToolFilters: (filters: ReadonlyArray<(name: string) => boolean>) => {
        seen.push(["bash", "read", "write"].filter((name) => filters.every((keep) => keep(name))));
      },
    };
    const one = createApi(recording, createRegistry(), () => {}, "a");
    // both filters live on one registry, the way two extensions share one
    const registry = createRegistry();
    const first = createApi(recording, registry, () => {}, "read-only");
    const second = createApi(recording, registry, () => {}, "no-write");
    first.filterTools((name) => name !== "bash");
    second.filterTools((name) => name !== "write");
    expect(seen.at(-1)).toEqual(["read"]);
    expect(one).toBeDefined();
    expect(g).toBeDefined();
  });

  test("lifting one filter leaves the others standing", () => {
    const seen: string[][] = [];
    const recording = {
      ...host,
      setToolFilters: (filters: ReadonlyArray<(name: string) => boolean>) => {
        seen.push(["bash", "read", "write"].filter((name) => filters.every((keep) => keep(name))));
      },
    };
    const registry = createRegistry();
    const first = createApi(recording, registry, () => {}, "read-only");
    const second = createApi(recording, registry, () => {}, "no-write");
    const held = first.filterTools((name) => name !== "bash");
    second.filterTools((name) => name !== "write");
    held.lift();
    expect(seen.at(-1)).toEqual(["bash", "read"]);
  });

  // Storage you cannot read is not storage.
  test("what an extension writes to the session, it can read back", () => {
    const { g } = api();
    g.appendEntry("prefs", { style: "terse" });
    g.appendEntry("prefs", { style: "loud" });
    g.appendEntry("other", { ignored: true });
    expect(g.entries("prefs")).toEqual([{ style: "terse" }, { style: "loud" }]);
  });

  test("a type nothing was written under reads empty, not undefined", () => {
    expect(api().g.entries("never-written")).toEqual([]);
  });
});

// Reported from a live session: glorious wrote an extension for the user, then
// `/reload` reported its resource counts and the extension was
// nowhere. Extensions were the one thing reload did not touch, and the message
// said nothing about the omission.
describe("reloading extensions", () => {
  const project = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), "glorious-reload-"));
    await mkdir(join(dir, ".glorious", "extensions"), { recursive: true });
    return dir;
  };

  const write = (dir: string, name: string, body: string): Promise<number> =>
    Bun.write(join(dir, ".glorious", "extensions", `${name}.ts`), body);

  const tool = (name: string) =>
    `export default function (g) {
       g.tool({ name: "${name}", description: "d", input: g.z.object({}), execute: async () => "ok" });
     }`;

  test("an extension installed mid-session appears after a reload", async () => {
    const dir = await project();
    const registry = createRegistry();
    const local = { ...host, root: dir };
    await loadExtensions(dir, registry, local, () => {});
    expect(Object.keys(registry.tools)).not.toContain("late_arrival");

    await write(dir, "late", tool("late_arrival"));
    resetRegistry(registry);
    await loadExtensions(dir, registry, local, () => {}, "1");
    expect(Object.keys(registry.tools)).toContain("late_arrival");
    await rm(dir, { recursive: true, force: true });
  });

  // The registry is held by reference by index.ts and the agent, so a reload
  // empties it in place rather than replacing it.
  test("a reload does not register everything twice", async () => {
    const dir = await project();
    await write(dir, "one", tool("just_one"));
    const registry = createRegistry();
    const local = { ...host, root: dir };
    await loadExtensions(dir, registry, local, () => {});
    resetRegistry(registry);
    await loadExtensions(dir, registry, local, () => {}, "2");
    expect(registry.commands.filter((command) => command.name === "just_one")).toHaveLength(0);
    expect(Object.keys(registry.tools).filter((name) => name === "just_one")).toHaveLength(1);
    await rm(dir, { recursive: true, force: true });
  });

  test("an edited extension is re-read, not served from the module cache", async () => {
    const dir = await project();
    await write(dir, "edited", tool("before_edit"));
    const registry = createRegistry();
    const local = { ...host, root: dir };
    await loadExtensions(dir, registry, local, () => {});
    expect(Object.keys(registry.tools)).toContain("before_edit");

    await write(dir, "edited", tool("after_edit"));
    resetRegistry(registry);
    await loadExtensions(dir, registry, local, () => {}, "3");
    expect(Object.keys(registry.tools)).toContain("after_edit");
    expect(Object.keys(registry.tools)).not.toContain("before_edit");
    await rm(dir, { recursive: true, force: true });
  });

  test("resetRegistry empties every container it owns", async () => {
    const dir = await project();
    await write(dir, "full", tool("some_tool"));
    const registry = createRegistry();
    await loadExtensions(dir, registry, { ...host, root: dir }, () => {});
    resetRegistry(registry);
    expect(Object.keys(registry.tools)).toEqual([]);
    expect(registry.commands).toEqual([]);
    expect(registry.promptLines).toEqual([]);
    expect(registry.contributions.size).toBe(0);
    expect(registry.handlers.size).toBe(0);
    await rm(dir, { recursive: true, force: true });
  });
});
