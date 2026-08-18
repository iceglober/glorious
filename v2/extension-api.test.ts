import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createApi, createRegistry, type ExtensionHost, type Glorious } from "./extension-api";

// The extension API is glorious's product surface: the core registers no tools
// and no commands of its own, so every capability anyone has runs through here.
// Nineteen of its forty members had never been named in a test, which is how
// `before_request` came to fire in the TUI and silently do nothing headlessly.
//
// Two guards live in this file. One says every member is exercised — enforced by
// recording what these tests actually touch, so it cannot rot. The other says
// every lifecycle event fires in both hosts unless it is on a list that says why
// not.

const here = import.meta.dir;

const members = (): string[] => {
  const source = readFileSync(join(here, "extension-api.ts"), "utf8");
  const body = source.slice(source.indexOf("export type Glorious = {"));
  return [...body.slice(0, body.indexOf("\n};")).matchAll(/^ {2}([a-zA-Z]+)\??:/gmu)].map(
    (match) => match[1],
  );
};

const touched = new Set<string>();

const harness = () => {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const registry = createRegistry();
  const record =
    (method: string) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return undefined;
    };
  const host = {
    root: "/tmp/project",
    mode: "tui" as const,
    exec: async (command: string) => {
      calls.push({ method: "exec", args: [command] });
      return { output: "", stdout: "", stderr: "", code: 0, ok: true };
    },
    send: record("send"),
    print: record("print"),
    columns: () => 100,
    capture: (spec: unknown) => {
      calls.push({ method: "capture", args: [spec] });
      return { close: () => {}, repaint: () => {} };
    },
    setInput: record("setInput"),
    inspect: () => ({ commands: [], sequences: [], skills: [], extensions: [] }),
    clear: () => "cleared" as const,
    compact: async () => ({ outcome: "too-short" as const }),
    reload: async () => {
      calls.push({ method: "reload", args: [] });
    },
    setToolFilters: record("setToolFilters"),
    tools: () => ["bash", "read"],
    model: () => ({ label: "azure/test", provider: "azure", modelId: "test" }),
    models: async () => [],
    setModel: async (...args: unknown[]) => {
      calls.push({ method: "setModel", args });
    },
    idle: () => true,
    pending: () => 0,
    abort: () => true,
    usage: () => ({
      tokens: 10,
      context: 100,
      total: { input: 1, output: 1, cached: 0, cost: 0, steps: 1 },
    }),
    systemPrompt: () => "the prompt",
    shutdown: record("shutdown"),
    session: () => ({ id: "s1", file: "/tmp/s1.json", title: "t", events: 3 }),
    setSessionName: record("setSessionName"),
    appendEntry: record("appendEntry"),
    entries: () => [{ kept: true }],
  } as unknown as ExtensionHost;

  const api = createApi(host, registry, () => {}, "test-extension");
  // Every property read is recorded, so the coverage guard at the bottom
  // measures what these tests genuinely exercise rather than what a list claims.
  const g = new Proxy(api, {
    get(target, key: string) {
      touched.add(key);
      return target[key as keyof Glorious];
    },
  }) as Glorious;
  return { g, registry, calls };
};

describe("what an extension can register", () => {
  test("a tool reaches the model's tool set, with its renderers", () => {
    const { g, registry } = harness();
    g.tool({
      name: "probe",
      description: "d",
      input: g.z.object({ path: g.z.string() }),
      execute: async () => "ok",
      renderCall: () => [[{ text: "calling" }]],
      renderResult: () => [[{ text: "done" }]],
    });
    expect(Object.keys(registry.tools)).toContain("probe");
    expect(registry.renderers.get("probe")?.call).toBeDefined();
    expect(registry.renderers.get("probe")?.result).toBeDefined();
  });

  test("a command reaches the command table and runs its own code", async () => {
    const { g, registry } = harness();
    let ran = "";
    g.command("probe", {
      description: "d",
      run: (args) => {
        ran = args;
      },
    });
    expect(registry.commands.map((one) => one.name)).toContain("probe");
    await registry.runners.get("probe")?.("with args");
    expect(ran).toBe("with args");
  });

  test("a key binding and a CLI flag are registered", () => {
    const { g, registry } = harness();
    g.key({ key: "g", ctrl: true, description: "go", run: () => {} });
    g.flag("since", { description: "d", run: () => {} });
    expect(registry.keys[0]).toMatchObject({ key: "g", ctrl: true });
    expect(registry.flags.has("since")).toBe(true);
  });

  test("prompt lines, status segments, footers and the activity row", () => {
    const { g, registry } = harness();
    g.prompt("remember this");
    g.status(() => "seg");
    g.footer(() => [[{ text: "row" }]]);
    g.activity(() => [[{ text: "busy" }]]);
    g.markdown((text) => text.toUpperCase());
    expect(registry.promptLines).toEqual(["remember this"]);
    expect(registry.statuses[0]()).toBe("seg");
    expect(registry.footers[0]()).toEqual([[{ text: "row" }]]);
    expect(registry.activities[0]({ busy: true, queued: 0, columns: 80 })).toEqual([
      [{ text: "busy" }],
    ]);
    expect(registry.markdown[0]("x")).toBe("X");
  });

  test("a handler is subscribed for the event it names", () => {
    const { g, registry } = harness();
    g.on("turn_start", () => undefined);
    expect(registry.handlers.get("turn_start")).toHaveLength(1);
  });
});

describe("what an extension can reach", () => {
  test("the project root and the terminal width", () => {
    const { g } = harness();
    expect(g.root).toBe("/tmp/project");
    expect(g.columns()).toBe(100);
    expect(g.hasUI).toBe(true);
    expect(g.mode).toBe("tui");
  });

  test("zod, so an extension needs no imports of its own", () => {
    const { g } = harness();
    expect(g.z.object({ a: g.z.string() }).safeParse({ a: "x" }).success).toBe(true);
  });

  test("clip counts what the terminal counts", () => {
    const { g } = harness();
    expect(g.clip("abcdef", 4)).toBe("abc…");
  });

  test("shell, and it carries the exit code back", async () => {
    const { g, calls } = harness();
    expect(await g.exec("ls")).toMatchObject({ code: 0, ok: true });
    expect(calls.some((one) => one.method === "exec")).toBe(true);
  });

  test("the turn: send, idle, pending, abort", () => {
    const { g, calls } = harness();
    g.send("go", { label: "/go", steer: true });
    expect(g.idle()).toBe(true);
    expect(g.pending()).toBe(0);
    expect(g.abort()).toBe(true);
    expect(calls.some((one) => one.method === "send")).toBe(true);
  });

  test("the model, and switching it", async () => {
    const { g, calls } = harness();
    expect(g.model().label).toBe("azure/test");
    expect(await g.models()).toEqual([]);
    await g.setModel("anthropic/claude-opus-5", "high");
    expect(calls.some((one) => one.method === "setModel")).toBe(true);
  });

  test("tools can be listed and narrowed, and the filter lifted", () => {
    const { g, registry, calls } = harness();
    expect(g.tools()).toEqual(["bash", "read"]);
    const held = g.filterTools((name) => name !== "bash");
    expect(registry.toolFilters).toHaveLength(1);
    held.lift();
    expect(registry.toolFilters).toHaveLength(0);
    expect(calls.filter((one) => one.method === "setToolFilters")).toHaveLength(2);
  });

  test("the session, its name, and data written into it", () => {
    const { g, calls } = harness();
    expect(g.session()).toMatchObject({ id: "s1", events: 3 });
    g.setSessionName("renamed");
    g.appendEntry("mine", { a: 1 });
    expect(g.entries("mine")).toEqual([{ kept: true }]);
    expect(calls.some((one) => one.method === "setSessionName")).toBe(true);
    expect(calls.some((one) => one.method === "appendEntry")).toBe(true);
  });

  test("usage, the system prompt, and what is loaded", () => {
    const { g } = harness();
    expect(g.usage().tokens).toBe(10);
    expect(g.systemPrompt()).toBe("the prompt");
    expect(g.inspect()).toMatchObject({ commands: [], skills: [] });
  });

  test("the conversation: clear, compact, reload", async () => {
    const { g, calls } = harness();
    expect(g.clear()).toBe("cleared");
    expect(await g.compact()).toEqual({ outcome: "too-short" });
    await g.reload();
    expect(calls.some((one) => one.method === "reload")).toBe(true);
  });

  test("printing into the transcript, and shutting down", () => {
    const { g, calls } = harness();
    g.print("plain", "warning");
    g.shutdown();
    expect(calls.some((one) => one.method === "print")).toBe(true);
    expect(calls.some((one) => one.method === "shutdown")).toBe(true);
  });

  test("the composer: capture and setInput", () => {
    const { g, calls } = harness();
    const held = g.ui.capture({ render: () => [[{ text: "x" }]], onKey: () => {} });
    held.close();
    g.ui.setInput("typed");
    expect(calls.some((one) => one.method === "capture")).toBe(true);
    expect(calls.some((one) => one.method === "setInput")).toBe(true);
  });

  test("extensions can talk to each other", () => {
    const { g } = harness();
    const heard: unknown[] = [];
    g.events.on("mine", (payload) => heard.push(payload));
    g.events.emit("mine", { n: 1 });
    expect(heard).toEqual([{ n: 1 }]);
  });
});

// Enforced by construction: the Proxy above records every member these tests
// read, so adding an API member without testing it fails here rather than
// shipping untested.
describe("the whole surface is exercised", () => {
  test("no API member is untested", () => {
    expect([...members()].filter((name) => !touched.has(name)).sort()).toEqual([]);
  });

  test("the guard is measuring something", () => {
    expect(members().length).toBeGreaterThan(30);
    expect(touched.size).toBeGreaterThan(30);
  });
});

// `before_request` fired only in the TUI, so an extension injecting per-turn
// context worked interactively and silently did nothing under `-p` — which is
// the mode the agent uses to check its own work, so the gap hid itself.
describe("every event fires in both hosts", () => {
  const TUI_ONLY: Record<string, string> = {
    input: "there is no composer to type into headlessly",
    user_bash: "`!` is a composer key",
    model_select: "a one-shot run cannot switch models",
    compact: "a one-shot run never compacts",
  };

  const names = (): string[] => {
    const source = readFileSync(join(here, "extension-api.ts"), "utf8");
    const block = source.slice(source.indexOf("export type EventName ="));
    return [...block.slice(0, block.indexOf(";")).matchAll(/"([a-z_]+)"/gu)].map((m) => m[1]);
  };

  const fires = (file: string): ((event: string) => boolean) => {
    const source = readFileSync(join(here, file), "utf8");
    return (event) => source.includes(`"${event}"`);
  };

  test("print mode fires everything the TUI does, or says why not", () => {
    const inPrint = fires("print.ts");
    const absent = names().filter((event) => !inPrint(event) && TUI_ONLY[event] === undefined);
    expect(absent).toEqual([]);
  });

  test("the TUI fires all of them", () => {
    const inTui = fires("index.ts");
    expect(names().filter((event) => !inTui(event))).toEqual([]);
  });

  test("the exceptions are real event names, not stale ones", () => {
    expect(Object.keys(TUI_ONLY).filter((event) => !names().includes(event))).toEqual([]);
  });
});
