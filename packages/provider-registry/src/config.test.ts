import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  CONFIG_SCHEMA_URL,
  configScopes,
  ensureConfigFiles,
  envSetting,
  loadConfig,
  userConfigDirectory,
} from "./config";

const roots: string[] = [];

const project = async (contents: string | null): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "glrs-config-"));
  roots.push(root);
  if (contents !== null) {
    await mkdir(join(root, ".glrs"), { recursive: true });
    await writeFile(join(root, ".glrs", "config.json"), contents);
  }
  return root;
};

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("loadConfig", () => {
  test("reads the model, variant, and tool timeout a project pins", async () => {
    const root = await project(
      `{"model":"anthropic/claude-opus-5","variant":"high","toolTimeoutMs":120000}`,
    );
    expect((await loadConfig(root, join(root, "nohome"))).config).toMatchObject({
      model: "anthropic/claude-opus-5",
      variant: "high",
      toolTimeoutMs: 120000,
    });
  });

  test("a missing config is not a problem", async () => {
    const root = await project(null);
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.model).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  // A config that silently does nothing is the hardest kind to debug, so a
  // broken one is reported — and the session still starts.
  test("malformed JSON is reported, not swallowed, and does not throw", async () => {
    const root = await project("{not json");
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.model).toBeUndefined();
    expect(diagnostics[0]).toContain("not valid JSON");
  });

  // A config file that grew a key glrs no longer knows about is not broken.
  // Refusing to start over one would be the worse failure.
  test("unknown keys are ignored rather than rejected", async () => {
    const root = await project(`{"model":"azure/x","mcpServers":{"old":{}},"nonsense":1}`);
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.model).toBe("azure/x");
    expect(diagnostics).toEqual([]);
  });

  test("provider settings survive, keyed by provider", async () => {
    const root = await project(`{"providers":{"google-vertex":{"project":"p","location":"l"}}}`);
    expect((await loadConfig(root, join(root, "nohome"))).config.providers).toEqual({
      "google-vertex": { api: undefined, region: undefined, project: "p", location: "l" },
    });
  });

  test("a non-string value is dropped rather than trusted", async () => {
    const root = await project(`{"model":42,"variant":""}`);
    const { config } = await loadConfig(root, join(root, "nohome"), {});
    expect(config.model).toBeUndefined();
    expect(config.variant).toBeUndefined();
  });
});

describe("initializing config files", () => {
  test("a non-project run creates only User config", async () => {
    const root = await mkdtemp(join(tmpdir(), "glrs-init-root-"));
    const home = await mkdtemp(join(tmpdir(), "glrs-init-home-"));
    roots.push(root, home);
    const created = await ensureConfigFiles(root, {
      project: false,
      home,
      env: {},
      platform: "linux",
    });
    expect(created).toEqual([join(home, ".config", "glrs", "config.json")]);
    expect(JSON.parse(await Bun.file(created[0]).text())).toEqual({ $schema: CONFIG_SCHEMA_URL });
    expect(await Bun.file(join(root, ".glrs", "config.json")).exists()).toBe(false);
  });

  test("a project run creates Project-User, Project, and User config", async () => {
    const root = await mkdtemp(join(tmpdir(), "glrs-init-project-"));
    const home = await mkdtemp(join(tmpdir(), "glrs-init-home-"));
    roots.push(root, home);
    const created = await ensureConfigFiles(root, {
      project: true,
      home,
      env: {},
      platform: "linux",
    });
    expect(created).toEqual([
      join(root, ".glrs", "config.local.json"),
      join(root, ".glrs", "config.json"),
      join(home, ".config", "glrs", "config.json"),
    ]);
    for (const path of created)
      expect(JSON.parse(await Bun.file(path).text())).toEqual({ $schema: CONFIG_SCHEMA_URL });
    expect(await Bun.file(join(root, ".glrs", ".gitignore")).text()).toBe("/config.local.json\n");
  });

  test("adds the schema to existing config in every resolved scope", async () => {
    const root = await mkdtemp(join(tmpdir(), "glrs-init-existing-"));
    const home = await mkdtemp(join(tmpdir(), "glrs-init-home-"));
    roots.push(root, home);
    const paths = configScopes(root, home, {}, "linux").map((scope) => scope.path);
    for (const path of paths) await mkdir(dirname(path), { recursive: true });
    await writeFile(paths[0], '{"variant":"high"}\n');
    await writeFile(paths[1], '{\n  "model": "openai/custom"\n}\n');
    await writeFile(paths[2], "{\n}\n");

    expect(
      await ensureConfigFiles(root, { project: true, home, env: {}, platform: "linux" }),
    ).toEqual([]);
    for (const path of paths)
      expect(JSON.parse(await Bun.file(path).text())).toMatchObject({ $schema: CONFIG_SCHEMA_URL });
    expect(await Bun.file(paths[1]).text()).toBe(
      `{\n  "$schema": "${CONFIG_SCHEMA_URL}",\n  "model": "openai/custom"\n}\n`,
    );
  });

  test("does not replace an existing schema or rewrite malformed JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "glrs-init-existing-"));
    const home = await mkdtemp(join(tmpdir(), "glrs-init-home-"));
    roots.push(root, home);
    const user = join(home, ".config", "glrs", "config.json");
    await mkdir(dirname(user), { recursive: true });
    const custom = '{"$schema":"https://example.com/custom.json","model":"openai/custom"}\n';
    await writeFile(user, custom);
    await ensureConfigFiles(root, { project: false, home, env: {}, platform: "linux" });
    expect(await Bun.file(user).text()).toBe(custom);

    await writeFile(user, "{not json\n");
    await ensureConfigFiles(root, { project: false, home, env: {}, platform: "linux" });
    expect(await Bun.file(user).text()).toBe("{not json\n");
  });
});

describe("provider and model overrides", () => {
  test("retains arbitrary JSON options instead of filtering provider-specific config", async () => {
    const root = await project(
      JSON.stringify({
        model: "openai/gpt-5",
        providers: {
          openai: {
            factoryOptions: {
              baseURL: "https://proxy.example/v1",
              organization: "org_123",
              headers: { "x-proxy": "yes" },
            },
            requestOptions: { temperature: 0.2, stopSequences: ["DONE"] },
            providerOptions: { openai: { store: true, customFutureOption: "kept" } },
            models: {
              "gpt-5": {
                requestOptions: { maxOutputTokens: 32000 },
                providerOptions: { openai: { reasoningEffort: "high" } },
                metadata: { context: 400000, inputCost: 1.25, outputCost: 10 },
              },
            },
          },
        },
      }),
    );
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(diagnostics).toEqual([]);
    expect(config.providers?.openai).toEqual({
      factoryOptions: {
        baseURL: "https://proxy.example/v1",
        organization: "org_123",
        headers: { "x-proxy": "yes" },
      },
      requestOptions: { temperature: 0.2, stopSequences: ["DONE"] },
      providerOptions: { openai: { store: true, customFutureOption: "kept" } },
      models: {
        "gpt-5": {
          requestOptions: { maxOutputTokens: 32000 },
          providerOptions: { openai: { reasoningEffort: "high" } },
          metadata: { context: 400000, inputCost: 1.25, outputCost: 10 },
        },
      },
    });
  });

  test("deep-merges scopes, replaces arrays, and uses null to remove inherited values", async () => {
    const root = await mkdtemp(join(tmpdir(), "glrs-options-project-"));
    const home = await mkdtemp(join(tmpdir(), "glrs-options-home-"));
    roots.push(root, home);
    await mkdir(join(root, ".glrs"), { recursive: true });
    await mkdir(join(home, ".config", "glrs"), { recursive: true });
    await writeFile(
      join(home, ".config", "glrs", "config.json"),
      JSON.stringify({
        providers: {
          openai: {
            factoryOptions: { organization: "remove-me", headers: { user: "yes" } },
            requestOptions: { stopSequences: ["USER"], temperature: 0.8 },
            providerOptions: { openai: { store: false, user: true } },
          },
        },
      }),
    );
    await writeFile(
      join(root, ".glrs", "config.json"),
      JSON.stringify({
        providers: {
          openai: {
            factoryOptions: { organization: null, headers: { project: "yes" } },
            requestOptions: { stopSequences: ["PROJECT"] },
            providerOptions: { openai: { store: true } },
          },
        },
      }),
    );
    const { config } = await loadConfig(root, home, {});
    expect(config.providers?.openai).toMatchObject({
      factoryOptions: { headers: { user: "yes", project: "yes" } },
      requestOptions: { stopSequences: ["PROJECT"], temperature: 0.8 },
      providerOptions: { openai: { store: true, user: true } },
    });
    expect(config.providers?.openai?.factoryOptions).not.toHaveProperty("organization");
  });

  test("validates model metadata without discarding its valid fields", async () => {
    const root = await project(
      JSON.stringify({
        providers: {
          openai: {
            models: {
              "gpt-5": {
                metadata: {
                  name: 42,
                  context: "large",
                  inputCost: -1,
                  outputCost: 10,
                  variants: ["high", 4],
                  unknown: "ignored",
                },
              },
            },
          },
        },
      }),
    );
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.providers?.openai?.models?.["gpt-5"]?.metadata).toEqual({
      outputCost: 10,
      variants: ["high"],
    });
    expect(diagnostics.join("\n")).toContain("models.gpt-5.metadata.name");
    expect(diagnostics.join("\n")).toContain("models.gpt-5.metadata.context");
    expect(diagnostics.join("\n")).toContain("models.gpt-5.metadata.inputCost");
    expect(diagnostics.join("\n")).toContain("models.gpt-5.metadata.variants[1]");
  });

  test("rejects provider option namespaces that are not objects", async () => {
    const root = await project(
      JSON.stringify({
        providers: {
          openai: {
            providerOptions: { openai: "not-an-object", future: { kept: true } },
            models: {
              "gpt-5": { providerOptions: { openai: 42, future: { model: true } } },
            },
          },
        },
      }),
    );
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.providers?.openai?.providerOptions).toEqual({ future: { kept: true } });
    expect(config.providers?.openai?.models?.["gpt-5"]?.providerOptions).toEqual({
      future: { model: true },
    });
    expect(diagnostics.join("\n")).toContain("providers.openai.providerOptions.openai");
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.models.gpt-5.providerOptions.openai",
    );
  });

  test("rejects request fields owned by the agent", async () => {
    const root = await project(
      JSON.stringify({
        model: "openai/gpt-5",
        providers: {
          openai: {
            factoryOptions: { fetch: "not allowed", baseURL: "https://example.test" },
            requestOptions: {
              prompt: "replace the user",
              system: "replace the system prompt",
              messages: [],
              tools: {},
              activeTools: [],
              abortSignal: null,
              onChunk: "not a callback",
            },
          },
        },
      }),
    );
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.providers?.openai?.requestOptions).toEqual({});
    expect(config.providers?.openai?.factoryOptions).toEqual({ baseURL: "https://example.test" });
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.factoryOptions.fetch is owned by glrs",
    );
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.requestOptions.prompt is owned by glrs",
    );
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.requestOptions.system is owned by glrs",
    );
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.requestOptions.messages is owned by glrs",
    );
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.requestOptions.tools is owned by glrs",
    );
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.requestOptions.activeTools is owned by glrs",
    );
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.requestOptions.abortSignal is owned by glrs",
    );
    expect(diagnostics.join("\n")).toContain(
      "providers.openai.requestOptions.onChunk is owned by glrs",
    );
  });
});

describe("the three config scopes", () => {
  test("Project-User, Project, then User", () => {
    const scopes = configScopes("/zz/project", "/zz/home", {}, "linux");
    expect(scopes).toEqual([
      { name: "Project-User", path: "/zz/project/.glrs/config.local.json" },
      { name: "Project", path: "/zz/project/.glrs/config.json" },
      { name: "User", path: "/zz/home/.config/glrs/config.json" },
    ]);
  });

  test("an explicit User directory wins over XDG", () => {
    expect(
      userConfigDirectory("/home/me", {
        GLRS_CONFIG_HOME: "/mine/glrs",
        XDG_CONFIG_HOME: "/xdg",
      }),
    ).toBe("/mine/glrs");
  });

  test("XDG_CONFIG_HOME contains the glrs User directory", () => {
    expect(userConfigDirectory("/home/me", { XDG_CONFIG_HOME: "/xdg" })).toBe("/xdg/glrs");
  });

  test("Windows uses roaming application data", () => {
    expect(userConfigDirectory("C:/Users/me", { APPDATA: "C:/Roaming" }, "win32")).toBe(
      "C:\\Roaming\\glrs",
    );
  });

  test("Project pins one key while User config supplies another", async () => {
    const home = await userConfig(`{"variant":"high"}`);
    const root = await project(`{"model":"anthropic/claude-opus-5"}`);
    const { config } = await loadConfig(root, home, {});
    expect(config).toMatchObject({ model: "anthropic/claude-opus-5", variant: "high" });
  });
});

// Reported from a live session: a project config set the model and the status
// line kept showing the default, with nothing said anywhere.
describe("a config that does not do what it looks like it does", () => {
  test("the .local. copy is read, and wins over the committed one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-local-"));
    await mkdir(join(dir, ".glrs"), { recursive: true });
    await writeFile(join(dir, ".glrs", "config.json"), '{"model":"azure/committed"}');
    await writeFile(join(dir, ".glrs", "config.local.json"), '{"model":"azure/mine"}');
    const { config } = await loadConfig(dir, join(dir, "nohome"));
    expect(config.model).toBe("azure/mine");
    await rm(dir, { recursive: true, force: true });
  });

  test("the .local. copy still layers, rather than replacing the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-local-"));
    await mkdir(join(dir, ".glrs"), { recursive: true });
    await writeFile(
      join(dir, ".glrs", "config.json"),
      '{"model":"azure/committed","variant":"high"}',
    );
    await writeFile(join(dir, ".glrs", "config.local.json"), '{"model":"azure/mine"}');
    const { config } = await loadConfig(dir, join(dir, "nohome"));
    expect(config).toMatchObject({ model: "azure/mine", variant: "high" });
    await rm(dir, { recursive: true, force: true });
  });

  // The key was recognised and the value was the wrong type, so it was dropped
  // exactly as silently as a typo.
  test("a recognised key of the wrong type says so", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-shape-"));
    await mkdir(join(dir, ".glrs"), { recursive: true });
    await writeFile(
      join(dir, ".glrs", "config.json"),
      '{"model":{"selected":"azure/gpt-5.6-sol"}}',
    );
    const { config, diagnostics } = await loadConfig(dir, join(dir, "nohome"));
    expect(config.model).toBeUndefined();
    expect(diagnostics.join("\n")).toContain('"model" should be a string');
    await rm(dir, { recursive: true, force: true });
  });

  test("a file written for something else says the whole thing is ignored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-alien-"));
    await mkdir(join(dir, ".glrs"), { recursive: true });
    await writeFile(
      join(dir, ".glrs", "config.json"),
      '{"agent":{"llm":{"model":"gpt-5.6-luna"}},"permissions":{}}',
    );
    const { diagnostics } = await loadConfig(dir, join(dir, "nohome"));
    expect(diagnostics.join("\n")).toContain("nothing here is a glrs setting");
    await rm(dir, { recursive: true, force: true });
  });

  test("an empty object is a real config, not a mistake", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-empty-"));
    await mkdir(join(dir, ".glrs"), { recursive: true });
    await writeFile(join(dir, ".glrs", "config.json"), "{}");
    expect((await loadConfig(dir, join(dir, "nohome"))).diagnostics).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  test("a schema-only file is recognized as glrs config", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-schema-"));
    await mkdir(join(dir, ".glrs"), { recursive: true });
    await writeFile(
      join(dir, ".glrs", "config.json"),
      '{"$schema":"https://glrs.dev/config.schema.json"}',
    );
    expect((await loadConfig(dir, join(dir, "nohome"))).diagnostics).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  test("a good config says nothing at all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glrs-good-"));
    await mkdir(join(dir, ".glrs"), { recursive: true });
    await writeFile(
      join(dir, ".glrs", "config.json"),
      '{"model":"azure/gpt-5.6-sol","providers":{"azure":{"api":"https://x"}}}',
    );
    const { config, diagnostics } = await loadConfig(dir, join(dir, "nohome"));
    expect(config.model).toBe("azure/gpt-5.6-sol");
    expect(diagnostics.filter((one) => one.includes(".glrs/config.json"))).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});

// The User scope, for checking that Project wins one key at a time.
const userConfig = async (contents: string): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), "glrs-home-"));
  roots.push(home);
  await mkdir(join(home, ".config", "glrs"), { recursive: true });
  await writeFile(join(home, ".config", "glrs", "config.json"), contents);
  return home;
};

describe("how a queue delivers", () => {
  test("nothing sets either mode by default", async () => {
    const root = await project('{"model":"azure/x"}');
    const { config } = await loadConfig(root, join(root, "nohome"));
    expect(config.steeringMode).toBeUndefined();
    expect(config.followUpMode).toBeUndefined();
  });

  test("the camelCase spellings are read", async () => {
    const root = await project('{"steeringMode":"all","followUpMode":"all"}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.steeringMode).toBe("all");
    expect(config.followUpMode).toBe("all");
    expect(diagnostics).toEqual([]);
  });

  test("snake_case names are not config keys", async () => {
    const root = await project('{"steering_mode":"all","follow_up_mode":"all"}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.steeringMode).toBeUndefined();
    expect(config.followUpMode).toBeUndefined();
    expect(diagnostics.join("\n")).toContain("nothing here is a glrs setting");
  });

  // A recognised key with an unusable value is otherwise dropped exactly as
  // silently as a typo.
  test("a value that is not a mode is reported under the name that was written", async () => {
    const root = await project('{"steeringMode":"batch"}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.steeringMode).toBeUndefined();
    expect(diagnostics.join("\n")).toContain('"steeringMode" should be "one-at-a-time" or "all"');
  });

  test("Project wins over User, one key at a time", async () => {
    const home = await userConfig('{"steeringMode":"all","followUpMode":"all"}');
    const root = await project('{"followUpMode":"one-at-a-time"}');
    const { config } = await loadConfig(root, home, {});
    expect(config.steeringMode).toBe("all");
    expect(config.followUpMode).toBe("one-at-a-time");
  });
});

describe("settings carried by the environment", () => {
  const clear = (): void => {
    for (const name of ["GLRS_PROBE", "GLORIOUS_PROBE"]) delete process.env[name];
  };

  test("the new name is read", () => {
    clear();
    process.env.GLRS_PROBE = "new";
    expect(envSetting("PROBE")).toBe("new");
    clear();
  });

  test("the old name still works on its own", () => {
    clear();
    process.env.GLORIOUS_PROBE = "old";
    expect(envSetting("PROBE")).toBe("old");
    clear();
  });

  test("with both set, the new name wins", () => {
    clear();
    process.env.GLRS_PROBE = "new";
    process.env.GLORIOUS_PROBE = "old";
    expect(envSetting("PROBE")).toBe("new");
    clear();
  });

  test("neither set is undefined, not an empty string", () => {
    clear();
    expect(envSetting("PROBE")).toBeUndefined();
  });
});

// Reported from a live session: the only way to turn off a bundled extension
// was to shadow it with a file of your own that did nothing, and an
// npm-installed glrs has no file to delete.
describe("which extensions load", () => {
  const written = async (contents: string): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), "glrs-ext-"));
    roots.push(root);
    await mkdir(join(root, ".glrs"), { recursive: true });
    await writeFile(join(root, ".glrs", "config.json"), contents);
    return root;
  };

  test("nothing sets a list by default", async () => {
    const root = await written('{"model":"azure/x"}');
    const { config } = await loadConfig(root, join(root, "nohome"));
    expect(config.extensions).toBeUndefined();
    expect(config.tools).toBeUndefined();
  });

  test("a list to load and a list to disable", async () => {
    const root = await written('{"extensions":{"load":["web-fetch"],"disable":["ask-user"]}}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.extensions?.load).toEqual(["web-fetch"]);
    expect(config.extensions?.disable).toEqual(["ask-user"]);
    expect(diagnostics).toEqual([]);
  });

  test("the bare-array shorthand is read as a load list", async () => {
    const root = await written('{"extensions":["web-fetch"]}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.extensions?.load).toEqual(["web-fetch"]);
    expect(diagnostics).toEqual([]);
  });

  test("tools.disable is its own block", async () => {
    const root = await written('{"tools":{"disable":["write","edit"]}}');
    expect((await loadConfig(root, join(root, "nohome"))).config.tools?.disable).toEqual([
      "write",
      "edit",
    ]);
  });

  test("a list that is not a list is reported", async () => {
    const root = await written('{"extensions":{"load":"web-fetch"}}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.extensions).toBeUndefined();
    expect(diagnostics.join("\n")).toContain("extensions.load should be an array");
  });

  // One bad entry is dropped by index; the rest of the list still works.
  test("a non-string entry is named by position and the rest survive", async () => {
    const root = await written('{"extensions":{"load":["web-fetch",42]}}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.extensions?.load).toEqual(["web-fetch"]);
    expect(diagnostics.join("\n")).toContain("extensions.load[1] should be a string");
  });

  test("a block with neither key says so", async () => {
    const root = await written('{"extensions":{"enabled":["web-fetch"]}}');
    const { diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(diagnostics.join("\n")).toContain('"extensions" has no "load" or "disable"');
  });

  // The trap: forget the KNOWN entry and a file configuring only extensions is
  // told the whole file was ignored, while the extensions load anyway.
  test("a file that sets only extensions is not called a foreign config", async () => {
    const root = await written('{"extensions":{"load":["web-fetch"]}}');
    const { diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(diagnostics.join("\n")).not.toContain("nothing here is a glrs setting");
  });

  // The other trap: merge is hand-written, and lists are sets rather than
  // values. Project activating one must not switch off the one User
  // config activates everywhere.
  test("the lists add up across layers rather than replacing", async () => {
    const home = await mkdtemp(join(tmpdir(), "glrs-ext-home-"));
    roots.push(home);
    await mkdir(join(home, ".config", "glrs"), { recursive: true });
    await writeFile(
      join(home, ".config", "glrs", "config.json"),
      '{"extensions":{"load":["ask-user"],"disable":["web-fetch"]}}',
    );
    const root = await written('{"extensions":{"load":["web-fetch"]}}');
    const { config } = await loadConfig(root, home, {});
    expect([...(config.extensions?.load ?? [])].sort()).toEqual(["ask-user", "web-fetch"]);
    // Disabled in User, still disabled even though Project asked for it.
    expect(config.extensions?.disable).toEqual(["web-fetch"]);
  });

  test("a relative path is resolved against the file that wrote it", async () => {
    const root = await written('{"extensions":{"load":["./ext/deploy.ts"]}}');
    const { config } = await loadConfig(root, join(root, "nohome"));
    expect(config.extensions?.load?.[0]).toBe(join(root, ".glrs", "ext", "deploy.ts"));
  });

  test("a package specifier is left exactly as written", async () => {
    const root = await written('{"extensions":{"load":["@glrs-dev/glrs-ext-web-fetch"]}}');
    expect((await loadConfig(root, join(root, "nohome"))).config.extensions?.load).toEqual([
      "@glrs-dev/glrs-ext-web-fetch",
    ]);
  });
});
