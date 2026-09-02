import { describe, expect, test } from "bun:test";
import { createApi, createRegistry, type ExtensionHost, fire } from "./extension-api";

const harness = () => {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const record =
    (name: string, result?: unknown) =>
    (...args: unknown[]) => {
      calls.push({ name, args });
      return result;
    };
  const host = {
    root: "/project",
    mode: "tui",
    settings: () => ({}),
    available: () => [],
    setExtension: async () => "already",
    exec: async () => ({ output: "", stdout: "", stderr: "", code: 0, ok: true }),
    send: record("send"),
    print: record("print"),
    columns: () => 80,
    capture: record("capture", { close: () => {}, repaint: () => {} }),
    mount: record("mount", { close: () => {}, repaint: () => {} }),
    notify: record("notify"),
    setTheme: record("setTheme", { restore: () => {} }),
    autocomplete: record("autocomplete", { dispose: () => {} }),
    setInput: record("setInput"),
    inspect: () => ({ commands: [], skills: [], extensions: [], keys: [], flags: [] }),
    clear: () => "empty",
    compact: async () => ({ outcome: "too-short" }),
    reload: async () => {},
    tools: () => ["read", "bash"],
    setToolFilters: record("setToolFilters"),
    model: () => ({ label: "openai/gpt", provider: "openai", modelId: "gpt", variant: "low" }),
    models: async () => [],
    setModel: async (...args: unknown[]) => calls.push({ name: "setModel", args }),
    registerProvider: record("registerProvider", { dispose: () => {} }),
    history: () => [{ role: "user", content: "hello" }],
    forkSession: async (...args: unknown[]) => {
      calls.push({ name: "forkSession", args });
      return { id: "forked", file: "/forked", title: "forked", events: 1 };
    },
    switchSession: async (...args: unknown[]) => {
      calls.push({ name: "switchSession", args });
      return true;
    },
    setLabel: record("setLabel"),
    idle: () => true,
    pending: () => 0,
    abort: () => false,
    usage: () => ({ tokens: 0, total: { input: 0, output: 0, cached: 0, cost: 0, steps: 0 } }),
    systemPrompt: () => "system",
    shutdown: record("shutdown"),
    session: () => ({ id: "s", file: "/s", title: "name", events: 1 }),
    setSessionName: record("setSessionName"),
    appendEntry: record("appendEntry"),
    entries: () => [],
  } as unknown as ExtensionHost;
  const registry = createRegistry();
  const g = createApi(host, registry, () => {}, "capability-test");
  return { g, registry, calls };
};

describe("new extension primitives", () => {
  test("a single mount primitive covers editor, widgets, header, footer and overlays", () => {
    const { g, calls } = harness();
    for (const placement of [
      "editor",
      "above-editor",
      "below-editor",
      "header",
      "footer",
      "overlay",
    ] as const)
      g.ui.mount({ placement, render: () => [[{ text: placement }]], onKey: () => {} });
    expect(calls.filter((call) => call.name === "mount")).toHaveLength(6);
  });

  test("notifications, themes and autocomplete are host capabilities", () => {
    const { g, calls } = harness();
    g.ui.notify("done", "success");
    g.ui.setTheme({ accent: "#ff0000" });
    g.autocomplete({ sigil: "#", complete: async () => [{ name: "123", description: "issue" }] });
    expect(calls.map((call) => call.name)).toContainAllValues([
      "notify",
      "setTheme",
      "autocomplete",
    ]);
  });

  test("providers can be registered and later removed", () => {
    const { g, calls } = harness();
    const registration = g.provider({
      id: "company",
      create: () => ({}) as never,
    });
    registration.dispose();
    expect(calls.find((call) => call.name === "registerProvider")?.args[0]).toMatchObject({
      id: "company",
    });
  });

  test("conversation and session controls delegate to the host", async () => {
    const { g, calls } = harness();
    expect(g.history()).toHaveLength(1);
    expect((await g.forkSession(3)).id).toBe("forked");
    expect(await g.switchSession("other")).toBe(true);
    g.setLabel(0, "bookmark");
    await g.setThinkingLevel("high");
    expect(calls.map((call) => call.name)).toContainAllValues([
      "forkSession",
      "switchSession",
      "setLabel",
      "setModel",
    ]);
  });

  test("message and custom-entry renderers are registered separately", () => {
    const { g, registry } = harness();
    g.messageRenderer(() => [[{ text: "message" }]]);
    g.entryRenderer("todo", () => [[{ text: "entry" }]]);
    expect(registry.messageRenderers).toHaveLength(1);
    expect(registry.entryRenderers.has("todo")).toBe(true);
  });

  test("lifecycle gates can block session changes and rewrite shell commands", async () => {
    const { g, registry } = harness();
    g.on("session_before_fork", () => false);
    g.on("user_bash", ({ command }) => ({ command: `ssh host ${command}` }));
    expect(await fire(registry, "session_before_fork", { id: "s", at: 2 }, () => {})).toBe(false);
    expect(await fire(registry, "user_bash", { command: "pwd" }, () => {})).toEqual({
      command: "ssh host pwd",
    });
  });

  test("terminating tools and structured results are represented in the registry", async () => {
    const { g, registry } = harness();
    g.tool({
      name: "final",
      description: "finish",
      input: g.z.object({}),
      terminate: true,
      execute: async () => ({ content: "done", data: { answer: 42 } }),
    });
    expect(registry.terminatingTools.has("final")).toBe(true);
    const execute = registry.tools.final.execute as (
      input: unknown,
      call: unknown,
    ) => Promise<string>;
    expect(await execute({}, {})).toBe("done");
    expect(g.truncateHead("abcdefghij", 7)).toBe("…defghij");
  });
});
