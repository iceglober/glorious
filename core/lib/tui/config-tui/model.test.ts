import { describe, expect, test } from "bun:test";
import { type ConfigTuiData, createConfigTuiModel, type KeyPress } from "./model";

const DATA: ConfigTuiData = {
  models: {
    plan: { ref: "azure/gpt-5.6-sol", provider: "azure", model: "gpt-5.6-sol", variant: "high" },
    build: {
      ref: "azure/gpt-5.6-luna",
      provider: "azure",
      model: "gpt-5.6-luna",
      variant: "medium",
    },
  },
  // Column 0 shows only connected providers (host filters); anthropic + bedrock
  // are unconnected and live in the catalog.
  modelProviders: ["azure", "openai", "vertex"],
  providerModels: {
    azure: ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.4-nano"],
    openai: ["gpt-4o", "gpt-4o-mini"],
  },
  reasoningModels: {
    azure: ["gpt-5.6-sol", "gpt-5.6-luna", "gpt-5.4-nano"],
    openai: [], // openai models here don't reason → no variant column
  },
  availableVariants: ["low", "medium", "high"],
  providers: [
    { name: "azure", connected: true, keyless: false },
    { name: "openai", connected: true, keyless: false },
    { name: "anthropic", connected: false, keyless: false },
    { name: "bedrock", connected: false, keyless: true },
    { name: "vertex", connected: true, keyless: true },
  ],
  connectableProviders: ["azure", "openai", "anthropic"],
  cloudAuth: {
    bedrock: {
      credsPresent: false,
      cliAvailable: true,
      loginArgv: ["aws", "sso", "login"],
      params: [{ key: "region", label: "region", placeholder: "us-east-1", value: "us-east-1" }],
    },
    vertex: {
      credsPresent: true,
      cliAvailable: true,
      loginArgv: ["gcloud", "auth", "application-default", "login"],
      params: [
        { key: "project", label: "project", placeholder: "my-gcp-project", value: "" },
        { key: "location", label: "location", placeholder: "us-central1", value: "us-central1" },
      ],
    },
  },
  trust: {
    uncaged: false,
    rules: [
      { pattern: "edit", decision: "allow", layer: "base" },
      { pattern: "bash(rm -rf *)", decision: "deny", layer: "project" },
    ],
  },
  mcp: [{ name: "github", transport: "stdio" }],
  layerPaths: {
    global: "~/.config/glorious/config.json",
    project: ".glorious/config.json",
    local: ".glorious/config.local.json",
  },
};

const k = (name: string, extra: Partial<KeyPress> = {}): KeyPress => ({ name, ...extra });
const fresh = () => createConfigTuiModel(structuredClone(DATA));
/** Feed a string into a text field one printable keypress at a time. */
const type = (m: ReturnType<typeof fresh>, s: string): void => {
  for (const ch of s) m.handleKey({ name: ch === " " ? "space" : ch, char: ch });
};

describe("config TUI model", () => {
  test("opens on Models; rows show the full provider/model", () => {
    const m = fresh();
    const v = m.view();
    expect(v.sections[0]).toEqual({ label: "Models", active: true });
    expect(v.rows[0]).toMatchObject({
      label: "Plan model",
      value: "azure/gpt-5.6-sol",
      note: "high",
      cursor: true,
    });
    expect(v.rows[1]).toMatchObject({ label: "Build model", value: "azure/gpt-5.6-luna" });
  });

  test("tab cycles sections; the cursor lands on the first focusable row", () => {
    const m = fresh();
    m.handleKey(k("tab")); // → Trust
    const v = m.view();
    expect(v.title).toContain("Trust");
    expect(v.rows.find((r) => r.cursor)?.label).toBe("Uncaged");
  });

  test("the picker opens on the provider column with the current provider selected", () => {
    const m = fresh();
    m.handleKey(k("return")); // open on col 0 (provider)
    const ov = m.view().overlay;
    expect(ov?.title).toBe("plan model");
    expect(ov?.columns?.[0]).toMatchObject({ title: "provider", active: true });
    expect(ov?.columns?.[0]?.items.find((i) => i.cursor)?.label).toBe("azure");
    // model + variant columns are pending until a provider is chosen.
    expect(ov?.columns?.[1]?.items[0]?.label).toBe("choose a provider");
  });

  test("navigate provider → model (reasoning) → variant, then confirm the scope to save", () => {
    const m = fresh();
    m.handleKey(k("return")); // col 0 provider (azure)
    m.handleKey(k("return")); // → col 1 model (azure, reasoning models)
    expect(m.view().overlay?.columns?.[1]?.title).toBe("model · azure");
    type(m, "sol"); // → gpt-5.6-sol
    expect(m.view().overlay?.columns?.[1]?.items.find((i) => i.cursor)?.note).toBe("gpt-5.6-sol");
    m.handleKey(k("return")); // azure model reasons → col 2 variant
    m.handleKey(k("up")); // high → medium
    // Committing the picker opens the scope prompt — nothing saved yet.
    expect(m.handleKey(k("return"))).toEqual([]);
    expect(m.view().overlay?.title).toBe("save to · plan model → azure/gpt-5.6-sol · medium");
    // Confirm at the default (Project) → the effect fires, scope routes to project.
    expect(m.handleKey(k("return"))).toEqual([
      { kind: "setModel", role: "plan", model: "azure/gpt-5.6-sol", variant: "medium" },
    ]);
    expect(m.scope()).toBe("project");
    expect(m.view().overlay).toBeUndefined();
  });

  test("a non-reasoning model has no variant column — commit then confirm scope", () => {
    const m = fresh();
    m.handleKey(k("return")); // col 0 provider (azure)
    m.handleKey(k("down")); // azure → openai
    m.handleKey(k("return")); // → col 1 openai models (none reason)
    // only two columns (no variant) while an openai model is selected.
    expect(m.view().overlay?.columns?.map((c) => c.title)).toEqual(["provider", "model · openai"]);
    type(m, "mini"); // gpt-4o-mini
    expect(m.handleKey(k("return"))).toEqual([]); // commit → scope prompt
    expect(m.handleKey(k("return"))).toEqual([
      { kind: "setModel", role: "plan", model: "openai/gpt-4o-mini" },
    ]);
  });

  test("Esc cancels the picker with nothing saved, from any column", () => {
    const m = fresh();
    m.handleKey(k("return")); // col 0
    m.handleKey(k("return")); // col 1
    type(m, "sol");
    m.handleKey(k("return")); // col 2 (variant)
    expect(m.view().overlay?.columns?.length).toBe(3);
    // Esc on the variant column: nothing committed, modal closes.
    expect(m.handleKey(k("escape"))).toEqual([]);
    expect(m.view().overlay).toBeUndefined();
  });

  test("← steps back a column and never saves; a no-op on the first column", () => {
    const m = fresh();
    m.handleKey(k("return")); // col 0
    expect(m.handleKey(k("left"))).toEqual([]); // no-op, still open on col 0
    expect(m.view().overlay?.columns?.[0]?.active).toBe(true);
    m.handleKey(k("return")); // col 1
    m.handleKey(k("left")); // back to col 0
    expect(m.view().overlay?.columns?.[0]?.active).toBe(true);
    expect(m.view().overlay).toBeDefined();
  });

  test("a typed literal id offers the variant column (unknown reasoning support)", () => {
    const m = fresh();
    m.handleKey(k("return")); // col 0 provider
    m.handleKey(k("down")); // openai (its catalogued models don't reason)
    m.handleKey(k("return")); // col 1
    type(m, "o1-2024"); // custom id, not in catalog
    expect(m.view().overlay?.columns?.find((c) => c.title === "variant")).toBeDefined();
    m.handleKey(k("return")); // → variant (custom id is offered one)
    expect(m.handleKey(k("return"))).toEqual([]); // commit → scope prompt
    expect(m.handleKey(k("return"))).toMatchObject([
      { kind: "setModel", role: "plan", model: "openai/o1-2024" },
    ]);
  });

  // ---- provider column = connected only; catalog connects the rest ----

  const catalogIdx = (m: ReturnType<typeof fresh>, provider: string): void => {
    // From an open catalog, move the cursor to `provider`.
    const order = ["azure", "openai", "anthropic", "bedrock", "vertex"];
    for (let i = 0; i < order.indexOf(provider); i += 1) m.handleKey(k("down"));
  };

  test("the provider column shows only connected providers, with status glyphs", () => {
    const m = fresh();
    m.handleKey(k("return"));
    const col0 = m.view().overlay?.columns?.[0]?.items ?? [];
    expect(col0.map((i) => i.label)).toEqual(["azure", "openai", "vertex", "+ Connect Provider"]); // connected only + catalog action
    const noteFor = (label: string) => col0.find((i) => i.label === label)?.note;
    expect(noteFor("azure")).toBe("✓"); // connected key
    expect(noteFor("vertex")).toBe("cloud ✓"); // cloud creds detected
  });

  test("a connected key provider advances straight to its models", () => {
    const m = fresh();
    m.handleKey(k("return")); // col 0, azure (connected key)
    m.handleKey(k("return")); // → models
    expect(m.view().overlay?.columns?.[1]).toMatchObject({ title: "model · azure", active: true });
  });

  test("selecting a cloud provider checks its session; valid → models", () => {
    const m = fresh();
    m.handleKey(k("return"));
    m.handleKey(k("down"));
    m.handleKey(k("down")); // → vertex (connected cloud)
    expect(m.view().overlay?.columns?.[0]?.items.find((i) => i.cursor)?.label).toBe("vertex");
    // ⏎ doesn't advance yet — it asks the screen to validate the live session.
    expect(m.handleKey(k("return"))).toEqual([
      { kind: "checkSession", provider: "vertex", role: "plan" },
    ]);
    expect(m.view().overlay?.title).toContain("checking vertex session");
    // The screen reports back: valid → into vertex's models.
    m.reportSessionCheck("vertex", "valid");
    expect(m.view().overlay?.columns?.[1]).toMatchObject({ title: "model · vertex", active: true });
  });

  test("a stale cloud session opens the setup form instead of models", () => {
    const m = fresh();
    m.handleKey(k("return"));
    m.handleKey(k("down"));
    m.handleKey(k("down")); // vertex
    m.handleKey(k("return")); // checkSession
    m.reportSessionCheck("vertex", "stale");
    expect(m.view().overlay?.title).toContain("connect vertex"); // cloud setup form
  });

  test("^n opens the catalog of every provider; esc returns to the picker", () => {
    const m = fresh();
    m.handleKey(k("return")); // picker col 0
    m.handleKey(k("n", { ctrl: true })); // → catalog
    const ov = m.view().overlay;
    expect(ov?.title).toBe("connect a provider");
    expect(ov?.items.map((i) => i.label)).toEqual([
      "azure",
      "openai",
      "anthropic",
      "bedrock",
      "vertex",
    ]);
    m.handleKey(k("escape")); // → back to the picker
    expect(m.view().overlay?.columns?.[0]?.active).toBe(true);
  });

  test("catalog: connecting a key provider returns to the catalog", () => {
    const m = fresh();
    m.handleKey(k("return"));
    m.handleKey(k("n", { ctrl: true })); // catalog
    catalogIdx(m, "anthropic"); // unconnected key provider
    m.handleKey(k("return")); // → connect form
    expect(m.view().overlay?.title).toBe("connect provider");
    m.handleKey(k("down")); // → api key field
    type(m, "sk-x");
    expect(m.handleKey(k("return"))).toEqual([
      { kind: "connectProvider", provider: "anthropic", apiKey: "sk-x" },
    ]);
    // Screen applies + reloads with anthropic connected → back to the catalog.
    const connected: ConfigTuiData = {
      ...structuredClone(DATA),
      providers: DATA.providers.map((p) =>
        p.name === "anthropic" ? { ...p, connected: true } : p,
      ),
    };
    m.reload(connected);
    expect(m.view().overlay?.title).toBe("connect a provider"); // catalog again
  });

  test("catalog: x disconnects a connected key provider; keyless opens cloud setup", () => {
    const m = fresh();
    m.handleKey(k("return"));
    m.handleKey(k("n", { ctrl: true }));
    // Cursor starts on azure (idx 0), a connected key provider → x disconnects.
    expect(m.handleKey(k("x"))).toEqual([{ kind: "disconnectProvider", provider: "azure" }]);
    // Move to bedrock (keyless) → ⏎ opens the cloud setup form.
    catalogIdx(m, "bedrock");
    m.handleKey(k("return"));
    expect(m.view().overlay?.title).toContain("connect bedrock");
  });

  test("catalog: connecting claude runs its OAuth login flow", () => {
    const dataWithClaude: ConfigTuiData = {
      ...structuredClone(DATA),
      providers: [...DATA.providers, { name: "claude", connected: false, keyless: true }],
    };
    const m = createConfigTuiModel(dataWithClaude);
    m.handleKey(k("return")); // picker col 0
    m.handleKey(k("n", { ctrl: true })); // → catalog
    // Move cursor down to claude
    const order = ["azure", "openai", "anthropic", "bedrock", "vertex", "claude"];
    for (let i = 0; i < order.indexOf("claude"); i += 1) m.handleKey(k("down"));

    // Pressing Enter on unconnected claude emits requestClaudeAuthUrl
    const effects = m.handleKey(k("return"));
    expect(effects).toHaveLength(1);
    expect(effects[0]).toMatchObject({
      kind: "requestClaudeAuthUrl",
    });
  });

  test("Plan/Build rows show the effective variant as a note", () => {
    const m = fresh();
    expect(m.view().rows[0]).toMatchObject({ label: "Plan model", note: "high" });
    expect(m.view().rows[1]).toMatchObject({ label: "Build model", note: "medium" });
  });

  test("Trust: uncaged toggles and rules cycle — each change confirms a scope", () => {
    const m = fresh();
    m.handleKey(k("tab")); // Trust, cursor on Uncaged
    expect(m.handleKey(k("space"))).toEqual([]); // toggle → scope prompt
    expect(m.handleKey(k("return"))).toEqual([{ kind: "setUncaged", on: true }]);
    // move to the first rule
    m.handleKey(k("down"));
    expect(m.view().rows.find((r) => r.cursor)?.label).toBe("edit");
    m.handleKey(k("right")); // cycle allow→ask → scope prompt
    expect(m.handleKey(k("return"))).toEqual([
      { kind: "setRule", pattern: "edit", decision: "ask" },
    ]);
    m.handleKey(k("x")); // remove → scope prompt
    expect(m.handleKey(k("return"))).toEqual([{ kind: "removeRule", pattern: "edit" }]);
  });

  test("Trust: + add rule overlay adds with a chosen decision", () => {
    const m = fresh();
    m.handleKey(k("tab"));
    // navigate to the add-rule action (last focusable before the floor)
    let guard = 0;
    while (m.view().rows.find((r) => r.cursor)?.label !== "+ add rule" && guard++ < 20)
      m.handleKey(k("down"));
    expect(m.handleKey(k("return"))).toEqual([]); // opens overlay
    expect(m.view().overlay?.title).toBe("add rule · allow");
    m.handleKey(k("right")); // decision allow→ask
    expect(m.view().overlay?.title).toBe("add rule · ask");
    m.handleKey(k("down")); // second suggestion
    expect(m.handleKey(k("return"))).toEqual([]); // commit rule → scope prompt
    const eff = m.handleKey(k("return")); // confirm scope
    expect(eff[0]).toMatchObject({ kind: "setRule", decision: "ask" });
  });

  test("MCP: x removes a server, r reloads, + add opens the form", () => {
    const m = fresh();
    m.handleKey(k("tab"));
    m.handleKey(k("tab")); // MCP (Models → Trust → MCP)
    expect(m.view().rows.find((r) => r.cursor)?.label).toBe("github");
    expect(m.handleKey(k("r"))).toEqual([{ kind: "reloadMcp" }]); // reload isn't a write
    m.handleKey(k("x")); // remove → scope prompt
    expect(m.handleKey(k("return"))).toEqual([{ kind: "removeServer", name: "github" }]);
    // after reload with the server gone, cursor rests on + add server
    m.reload({ ...DATA, mcp: [] });
    m.handleKey(k("return"));
    expect(m.view().overlay?.title).toBe("add MCP server");
  });

  test("MCP: the add-server form captures typed name, transport, and target", () => {
    const m = fresh();
    m.handleKey(k("tab"));
    m.handleKey(k("tab")); // MCP
    m.reload({ ...DATA, mcp: [] });
    m.handleKey(k("return")); // open form on the name field

    // ⏎ with empty fields does nothing — both name and target are required.
    expect(m.handleKey(k("return"))).toEqual([]);

    type(m, "linear"); // type into the name field
    m.handleKey(k("down")); // → transport
    m.handleKey(k("right")); // stdio → http
    expect(m.view().overlay?.items[1]?.note).toBe("stdio ‹http›");
    m.handleKey(k("down")); // → target (labeled "url" for http)
    expect(m.view().overlay?.items[2]?.label).toBe("url");
    type(m, "https://mcp.linear.app/sse");

    expect(m.handleKey(k("return"))).toEqual([]); // commit form → scope prompt
    expect(m.handleKey(k("return"))).toEqual([
      {
        kind: "addServer",
        name: "linear",
        transport: "http",
        target: "https://mcp.linear.app/sse",
      },
    ]);
    expect(m.view().overlay).toBeUndefined();
  });

  test("q and ctrl-c quit", () => {
    expect(fresh().handleKey(k("q"))).toEqual([{ kind: "quit" }]);
    expect(fresh().handleKey(k("c", { ctrl: true }))).toEqual([{ kind: "quit" }]);
  });

  test("the scope prompt defaults to Project and routes the save there", () => {
    const m = fresh();
    // Footer advertises the default save target.
    expect(m.view()).toMatchObject({
      scopeLabel: "Project",
      scopePath: ".glorious/config.json",
    });
    m.handleKey(k("tab")); // Trust
    m.handleKey(k("space")); // toggle uncaged → scope prompt
    const ov = m.view().overlay;
    expect(ov?.title).toBe("save to · uncaged: on");
    expect(ov?.items.map((i) => i.label)).toEqual(["Global", "Project", "ProjectLocal"]);
    expect(ov?.items.map((i) => i.note)).toEqual([
      "~/.config/glorious/config.json",
      ".glorious/config.json",
      ".glorious/config.local.json",
    ]);
    expect(ov?.items.find((i) => i.cursor)?.label).toBe("Project"); // default
    expect(m.handleKey(k("return"))).toEqual([{ kind: "setUncaged", on: true }]);
    expect(m.scope()).toBe("project");
  });

  test("the scope prompt can target Global or Local; Esc discards the change", () => {
    const m = fresh();
    m.handleKey(k("tab"));
    m.handleKey(k("space")); // → scope prompt (cursor on Project)
    m.handleKey(k("up")); // Project → Global
    expect(m.handleKey(k("return"))).toEqual([{ kind: "setUncaged", on: true }]);
    expect(m.scope()).toBe("global");
    // A new change routed to Local.
    m.handleKey(k("space"));
    m.handleKey(k("down")); // Project → ProjectLocal
    expect(m.handleKey(k("return"))).toEqual([{ kind: "setUncaged", on: true }]);
    expect(m.scope()).toBe("local");
    // A change discarded with Esc emits nothing and closes the prompt.
    m.handleKey(k("space"));
    expect(m.view().overlay?.title).toContain("save to");
    expect(m.handleKey(k("escape"))).toEqual([]);
    expect(m.view().overlay).toBeUndefined();
  });

  test("the keybar advertises ←→ only where the focused row responds to it", () => {
    const m = fresh();
    const keyNames = () => m.view().keys.map(([k]) => k);
    // Models: Enter opens the picker; ←→ does nothing → not shown.
    expect(keyNames()).toContain("⏎");
    expect(keyNames()).not.toContain("←→");
    // Trust rules cycle their decision with ←→ → shown, plus x to remove.
    m.handleKey(k("tab"));
    m.handleKey(k("down")); // onto the first rule ("edit")
    expect(m.view().rows.find((r) => r.cursor)?.label).toBe("edit");
    expect(keyNames()).toContain("←→");
    expect(keyNames()).toContain("x");
    // MCP server row: only removable → x but no ←→.
    m.handleKey(k("tab")); // Trust → MCP, cursor on the github server
    expect(keyNames()).toContain("x");
    expect(keyNames()).not.toContain("←→");
  });

  test("provenance: a value's source layer shows as a note; base/default do not", () => {
    const m = fresh();
    m.handleKey(k("tab")); // Trust
    const rows = m.view().rows;
    // The base-provided rule carries no tag; the project-set rule shows "project".
    expect(rows.find((r) => r.label === "edit")?.note).toBeUndefined();
    expect(rows.find((r) => r.label === "bash(rm -rf *)")?.note).toBe("project");
  });
});
