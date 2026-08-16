import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRegistry,
  describeContribution,
  type ExtensionHost,
  fire,
  type Registry,
} from "./extension-api";
import { loadExtensions } from "./extensions";
import type { ToolEvent } from "./tools";

let root = "";
const asked: string[] = [];
const printed: string[] = [];
const sent: string[] = [];

const host: ExtensionHost = {
  get root() {
    return root;
  },
  exec: async (command) => ({ output: `ran ${command}`, stdout: `ran ${command}`, ok: true }),
  send: (text) => {
    sent.push(text);
  },
  print: (text) => {
    printed.push(text);
  },
  ask: async (questions) => {
    asked.push(questions[0].question);
    return "{}";
  },
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
  g.on("turn_start", ({ text }) => { if (text === "swallow me") return false; });
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
    expect(await fire(registry, "turn_start", { text: "swallow me" }, () => {})).toBe(false);
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
    registry.handlers.set("turn_start", [
      () => {
        throw new Error("nope");
      },
      () => "survived",
    ]);
    const failures: string[] = [];
    const said = await fire(registry, "turn_start", { text: "x" }, (m) => failures.push(m));
    expect(failures[0]).toContain("nope");
    expect(said).toBe("survived");
  });
});
