import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createApi,
  createRegistry,
  describeContribution,
  type ExtensionHost,
  fire,
  type Glrs,
  promptContributions,
  type Registry,
} from "./extension-api";

// The extension API is glrs's product surface: the core registers no tools
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
  const source =
    readFileSync(join(here, "extension-api.ts"), "utf8") +
    readFileSync(join(here, "..", "..", "glrs-core", "src", "index.ts"), "utf8");
  const body = source.slice(source.indexOf("export type Glrs = {"));
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
    settings: () => ({ toolTimeoutMs: 4242, steeringMode: "all" as const }),
    available: () => [
      { name: "builtins", summary: "the tools and commands", state: "on" as const },
      { name: "web-fetch", summary: "fetches web pages", state: "undecided" as const },
    ],
    setExtension: async (...args: unknown[]) => {
      calls.push({ method: "setExtension", args });
      return "written" as const;
    },
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
    inspect: () => ({ commands: [], skills: [], extensions: [] }),
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
      return target[key as keyof Glrs];
    },
  }) as Glrs;
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

// The one member the tools extension is written against. Without it the tools
// could not tell how long a command may run, and the only way to find out would
// be to import the coding agent — which is exactly what an extension may not do.
describe("what the host tells an extension about the session", () => {
  test("settings carry the resolved config, without the provider blocks", () => {
    const { g } = harness();
    const settings = g.settings();
    expect(settings.toolTimeoutMs).toBe(4242);
    expect(settings.steeringMode).toBe("all");
    // Provider settings hold API keys. An extension that wants them can read
    // the config files itself rather than being handed them.
    expect("providers" in settings).toBe(false);
  });
});

// What lets an extension offer a capability the session does not have. The
// three states come from config; recording a choice writes it, but only where
// agentConfigAllowlist says glrs may.
describe("first-party extensions that have not loaded", () => {
  test("available reports each one's state", () => {
    const { g } = harness();
    const offered = g.available();
    expect(offered.map((one) => one.name)).toEqual(["builtins", "web-fetch"]);
    expect(offered.find((one) => one.name === "web-fetch")?.state).toBe("undecided");
  });

  test("setExtension hands the choice to the host", async () => {
    const { g, calls } = harness();
    expect(await g.setExtension("web-fetch", true)).toBe("written");
    expect(calls.at(-1)).toEqual({ method: "setExtension", args: ["web-fetch", true] });
  });
});

// A subcommand of the executable. Registered like a tool rather than like a
// slash command, because two extensions offering `glrs wt` must not depend on
// which loaded first.
describe("subcommands an extension adds to the executable", () => {
  test("it lands in the registry under its own name", () => {
    const { g, registry } = harness();
    g.cli("wt", { description: "worktrees", run: () => {} });
    expect(registry.cli.get("wt")?.description).toBe("worktrees");
    expect(registry.cli.get("wt")?.origin).toBe("test-extension");
  });

  test("the name is lowercased, the way commands are", () => {
    const { g, registry } = harness();
    g.cli("WT", { description: "d", run: () => {} });
    expect(registry.cli.has("wt")).toBe(true);
  });

  test("the first extension to claim a subcommand keeps it", async () => {
    const { g, registry } = harness();
    let ran = "";
    g.cli("wt", {
      description: "the project's",
      run: () => {
        ran = "project";
      },
    });
    const shipped = createApi(
      { root: "/tmp/project", mode: "tui" } as unknown as ExtensionHost,
      registry,
      () => {},
      "@glrs-dev/glrs-ext-worktree",
    );
    shipped.cli("wt", {
      description: "the shipped one",
      run: () => {
        ran = "shipped";
      },
    });

    await registry.cli.get("wt")?.run([]);
    expect(ran).toBe("project");
    // The loser is reported rather than dropped, so /extensions stays honest.
    expect(describeContribution(registry, "@glrs-dev/glrs-ext-worktree")).toContain("shadowed");
  });

  test("what it registered shows up in the contribution ledger", () => {
    const { g, registry } = harness();
    g.cli("wt", { description: "d", run: () => {} });
    expect(describeContribution(registry, "test-extension")).toContain("cli: glrs wt");
  });
});

// A contribution can be a string decided at registration or a function asked
// fresh each turn. The second is what lets an extension say something about the
// session rather than only about itself.
describe("what an extension contributes to the per-turn preamble", () => {
  test("a string is carried through as written", () => {
    const { g, registry } = harness();
    g.prompt("use bun, not npm");
    expect(promptContributions(registry.promptLines)).toEqual(["use bun, not npm"]);
  });

  test("a function is asked each time, so it can change between turns", () => {
    const { g, registry } = harness();
    let count = 0;
    g.prompt(() => {
      count += 1;
      return `asked ${count} time(s)`;
    });
    expect(promptContributions(registry.promptLines)).toEqual(["asked 1 time(s)"]);
    expect(promptContributions(registry.promptLines)).toEqual(["asked 2 time(s)"]);
  });

  // Saying nothing has to be possible, or a contribution that is only sometimes
  // relevant costs a blank line in every turn that does not need it.
  test("an empty string says nothing at all", () => {
    const { g, registry } = harness();
    g.prompt("");
    g.prompt(() => "");
    expect(promptContributions(registry.promptLines)).toEqual([]);
  });

  test("one that throws costs its own line, not the turn", () => {
    const { g, registry } = harness();
    g.prompt("before");
    g.prompt(() => {
      throw new Error("no");
    });
    g.prompt("after");
    expect(promptContributions(registry.promptLines)).toEqual(["before", "after"]);
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
    const source =
      readFileSync(join(here, "extension-api.ts"), "utf8") +
      readFileSync(join(here, "..", "..", "glrs-core", "src", "index.ts"), "utf8");
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

// `before_request` appends a string to the turn's message. That is the whole of
// what it can do, so redaction, windowing and message-level rewriting were out
// of reach — and nothing could see the HTTP request at all, which is the layer
// a gateway, a signing proxy or a request log needs.
describe("the request pipeline is interceptable", () => {
  const say = <E extends "context" | "before_provider_request" | "after_provider_response">(
    event: E,
    handler: Parameters<Glrs["on"]>[1],
  ) => {
    const { g, registry } = harness();
    g.on(event as never, handler as never);
    return registry;
  };

  test("context replaces what is sent, and is given the step", async () => {
    const seen: number[] = [];
    const registry = say("context", (payload) => {
      seen.push((payload as { step: number }).step);
      return [{ role: "user", content: "instead" }] as never;
    });
    const said = await fire(
      registry,
      "context",
      { messages: [{ role: "user", content: "original" }], step: 2 },
      () => {},
    );
    expect(said).toEqual([{ role: "user", content: "instead" }]);
    expect(seen).toEqual([2]);
  });

  test("a context handler that returns nothing leaves the messages alone", async () => {
    const registry = say("context", () => undefined);
    expect(await fire(registry, "context", { messages: [], step: 1 }, () => {})).toBeUndefined();
  });

  test("a request handler can add headers and replace the body", async () => {
    const registry = say("before_provider_request", () => ({
      headers: { authorization: "Bearer x" },
      body: { replaced: true },
    }));
    expect(
      await fire(
        registry,
        "before_provider_request",
        { url: "https://p/x", headers: {}, body: { original: true } },
        () => {},
      ),
    ).toEqual({ headers: { authorization: "Bearer x" }, body: { replaced: true } });
  });

  test("a response handler sees the status and headers", async () => {
    const seen: number[] = [];
    const registry = say("after_provider_response", (payload) => {
      seen.push((payload as { status: number }).status);
      return undefined;
    });
    await fire(
      registry,
      "after_provider_response",
      { url: "https://p/x", status: 429, headers: { "retry-after": "3" } },
      () => {},
    );
    expect(seen).toEqual([429]);
  });

  // A handler that throws must not take the request with it.
  test("a failing handler is reported and the request still goes", async () => {
    const failures: string[] = [];
    const registry = say("before_provider_request", () => {
      throw new Error("nope");
    });
    const said = await fire(
      registry,
      "before_provider_request",
      { url: "https://p/x", headers: {}, body: {} },
      (message) => failures.push(message),
    );
    expect(said).toBeUndefined();
    expect(failures[0]).toContain("nope");
  });
});

// docs/published/5-internals/3-lifecycle.md is the page the model is pointed at to learn what
// it can hook. A page that lists an event glrs does not have, or omits one
// it does, is worse than no page.
describe("the lifecycle page matches the code", () => {
  const page = (): string =>
    readFileSync(
      join(here, "..", "..", "..", "docs", "published", "5-internals", "3-lifecycle.md"),
      "utf8",
    );

  const eventNames = (): string[] => {
    const source =
      readFileSync(join(here, "extension-api.ts"), "utf8") +
      readFileSync(join(here, "..", "..", "glrs-core", "src", "index.ts"), "utf8");
    const block = source.slice(source.indexOf("export type EventName ="));
    return [...block.slice(0, block.indexOf(";")).matchAll(/"([a-z_]+)"/gu)].map((m) => m[1]);
  };

  test("every event is on the page", () => {
    const text = page();
    expect(eventNames().filter((event) => !text.includes(event))).toEqual([]);
  });

  test("the page invents no events", () => {
    const known = new Set(eventNames());
    const listed = [...page().matchAll(/^\| `([a-z_]+)` \|/gmu)].map((m) => m[1]);
    expect(listed.filter((event) => !known.has(event))).toEqual([]);
    expect(listed.length).toBe(known.size);
  });
});

// Tool names were the one namespace here where the *last* registration won.
// Every other one — commands, user commands, skills, the activity row — is
// first-wins, and the exception ran backwards: the later an extension loaded,
// the more it could take. Since the loader walks the project before anything
// first-party extensions, first-wins is what makes a project extension able to replace
// a tool that ships in the box.
describe("two extensions claiming one tool name", () => {
  const joining = (registry: Registry, origin: string): Glrs =>
    createApi(
      { root: "/tmp/project", mode: "tui" } as unknown as ExtensionHost,
      registry,
      () => {},
      origin,
    );

  const run = async (registry: Registry, name: string): Promise<string> => {
    const entry = registry.tools[name] as {
      execute: (input: unknown, call: unknown) => Promise<string>;
    };
    return entry.execute({}, {});
  };

  test("the first registration is the one the model gets", async () => {
    const { g, registry } = harness();
    g.tool({
      name: "bash",
      description: "the project's",
      input: g.z.object({}),
      execute: async () => "from the project",
    });
    const shipped = joining(registry, "@glrs-dev/glrs-ext-builtins");
    shipped.tool({
      name: "bash",
      description: "the first-party one",
      input: shipped.z.object({}),
      execute: async () => "from the box",
    });

    // Executed rather than counted. Both registrations leave a key of the same
    // name behind, so the only assertion that means anything is whose body ran.
    expect(await run(registry, "bash")).toBe("from the project");
  });

  test("the renderer stays with whoever won the name", () => {
    const { g, registry } = harness();
    g.tool({
      name: "bash",
      description: "the project's",
      input: g.z.object({}),
      execute: async () => "ok",
    });
    const shipped = joining(registry, "@glrs-dev/glrs-ext-builtins");
    shipped.tool({
      name: "bash",
      description: "the first-party one",
      input: shipped.z.object({}),
      execute: async () => "ok",
      renderCall: () => [[{ text: "from the box" }]],
    });
    // The winner registered no renderer, so there must not be one — a tool and
    // its renderer being drawn from different extensions would render a call
    // that never happens.
    expect(registry.renderers.has("bash")).toBe(false);
  });

  test("the one that lost says so instead of claiming the tool", () => {
    const { g, registry } = harness();
    g.tool({
      name: "bash",
      description: "the project's",
      input: g.z.object({}),
      execute: async () => "ok",
    });
    const shipped = joining(registry, "@glrs-dev/glrs-ext-builtins");
    shipped.tool({
      name: "bash",
      description: "the first-party one",
      input: shipped.z.object({}),
      execute: async () => "ok",
    });
    // /extensions is the only account anyone gets of what a loaded extension
    // did, there being no approval prompt to have read it out beforehand.
    // Listing a tool it does not own would make that account wrong.
    expect(describeContribution(registry, "test-extension")).toContain("tools: bash");
    expect(describeContribution(registry, "@glrs-dev/glrs-ext-builtins")).toBe("shadowed: bash");
  });

  test("a name nobody else claimed is registered as normal", async () => {
    const { g, registry } = harness();
    g.tool({
      name: "solo",
      description: "d",
      input: g.z.object({}),
      execute: async () => "only me",
    });
    expect(await run(registry, "solo")).toBe("only me");
  });
});

// The API extensions are written against and the object glrs builds were two
// separate declarations, and they drifted: the copy carried 26 members while
// the object carried 44, so `model`, `tools`, `status`, `footer`, `key`,
// `flag`, `abort`, `setModel` and ten more worked at runtime and were invisible
// to anyone writing an extension. There is one declaration now, and these pin
// that there stays one.
describe("the extension API is declared once", () => {
  const core = readFileSync(join(here, "..", "..", "glrs-core", "src", "index.ts"), "utf8");
  const api = readFileSync(join(here, "extension-api.ts"), "utf8");

  test("glrs-core declares it and the coding agent does not redeclare it", () => {
    expect(core).toContain("export type Glrs = {");
    expect(api).not.toContain("export type Glrs = {");
  });

  test("the agent implements that type rather than describing its own", () => {
    // `createApi` returns `Glrs`, and `Glrs` is now the one extensions import —
    // so an implementation that falls behind the type cannot compile.
    expect(api).toMatch(/createApi = \([\s\S]*?\): Glrs =>/u);
  });

  test("extensions reach it without importing the coding agent", () => {
    // The boundary check forbids it, which is what forced the copy originally.
    for (const name of ["builtins", "ask-user", "web-fetch", "worktree"]) {
      const source = readFileSync(
        join(here, "..", "..", "extensions", name, "src", "index.ts"),
        "utf8",
      );
      expect(source).toContain("glrs-core/src");
      expect(source).not.toContain("glrs-coding-agent");
    }
  });

  test("no member is declared without being built", () => {
    const declared = members();
    // Every member named on the type appears as a key on the object literal
    // `createApi` returns. A member with no implementation used to typecheck as
    // optional and be undefined at runtime.
    for (const name of declared) expect(api).toMatch(new RegExp(`^\\s{4}${name}[:(,]`, "mu"));
  });
});

// Tone and Span drifted the same way Glrs did: the renderer honoured seven
// tones and italic/underline spans, and the type extensions import named five
// tones and neither attribute.
describe("what the renderer draws is what the type allows", () => {
  const core = readFileSync(join(here, "..", "..", "glrs-core", "src", "index.ts"), "utf8");
  const render = readFileSync(join(here, "render.ts"), "utf8");

  test("every tone the renderer paints can be named by an extension", () => {
    const painted = [
      ...render.matchAll(/^ {2}(accent|highlight|muted|prompt|success|warning|danger):/gmu),
    ].map((one) => one[1]);
    const declared = core.slice(
      core.indexOf("export type Tone ="),
      core.indexOf(";", core.indexOf("export type Tone =")),
    );
    for (const tone of new Set(painted)) expect(declared).toContain(`"${tone}"`);
  });

  test("neither is declared twice", () => {
    expect(render).not.toMatch(/^export type Tone =/mu);
    expect(render).not.toMatch(/^export type Span = \{/mu);
  });

  test("span attributes the renderer honours are on the type", () => {
    const span = core.slice(core.indexOf("export type Span = {"));
    for (const attribute of ["bold", "italic", "underline", "fill"])
      expect(span.slice(0, span.indexOf("};"))).toContain(attribute);
  });
});
