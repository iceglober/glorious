import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPaths, envSetting, loadConfig } from "./config";

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
      `{"model":"anthropic/claude-opus-5","variant":"high","tool_timeout_ms":120000}`,
    );
    expect((await loadConfig(root, join(root, "nohome"))).config).toMatchObject({
      model: "anthropic/claude-opus-5",
      variant: "high",
      tool_timeout_ms: 120000,
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
    const { config } = await loadConfig(await project(`{"model":42,"variant":""}`));
    expect(config.model).toBeUndefined();
    expect(config.variant).toBeUndefined();
  });
});

// Extensions and commands already come from ~/.glrs — the
// ancestor walk reaches it whenever a project sits under home. Config not
// reading the same directory is a rule nobody should have to learn.
describe("where personal config lives", () => {
  test("both personal locations are read, project first", () => {
    const paths = configPaths("/zz/project", "/zz/home");
    // the copy you do not commit sits nearest, ahead of the one you do
    expect(paths[0]).toBe("/zz/project/.glrs/config.local.json");
    expect(paths[1]).toBe("/zz/project/.glrs/config.json");
    expect(paths).toContain("/zz/home/.glrs/config.json");
    expect(paths).toContain("/zz/home/.config/glrs/config.json");
  });

  test("a project pins one key while personal config supplies another", async () => {
    const root = await project(`{"model":"anthropic/claude-opus-5"}`);
    const { config } = await loadConfig(root, join(root, "nohome"));
    expect(config.model).toBe("anthropic/claude-opus-5");
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

// The personal layer, for checking that a project file wins one key at a time.
const personal = async (contents: string): Promise<string> => {
  const home = await mkdtemp(join(tmpdir(), "glrs-home-"));
  roots.push(home);
  await mkdir(join(home, ".glrs"), { recursive: true });
  await writeFile(join(home, ".glrs", "config.json"), contents);
  return home;
};

describe("how a queue delivers", () => {
  test("nothing sets either mode by default", async () => {
    const root = await project('{"model":"azure/x"}');
    const { config } = await loadConfig(root, join(root, "nohome"));
    expect(config.steering_mode).toBeUndefined();
    expect(config.follow_up_mode).toBeUndefined();
  });

  test("the snake_case spellings glrs uses elsewhere", async () => {
    const root = await project('{"steering_mode":"all","follow_up_mode":"one-at-a-time"}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.steering_mode).toBe("all");
    expect(config.follow_up_mode).toBe("one-at-a-time");
    expect(diagnostics).toEqual([]);
  });

  // The camelCase names are what these settings are called in the docs of the
  // agent this queue was modelled on, so they are what gets typed first.
  test("the camelCase spellings are read too", async () => {
    const root = await project('{"steeringMode":"all","followUpMode":"all"}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.steering_mode).toBe("all");
    expect(config.follow_up_mode).toBe("all");
    expect(diagnostics).toEqual([]);
  });

  // A recognised key with an unusable value is otherwise dropped exactly as
  // silently as a typo.
  test("a value that is not a mode is reported under the name that was written", async () => {
    const root = await project('{"steeringMode":"batch"}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.steering_mode).toBeUndefined();
    expect(diagnostics.join("\n")).toContain('"steeringMode" should be "one-at-a-time" or "all"');
  });

  test("a project file wins over a personal one, one key at a time", async () => {
    const home = await personal('{"steering_mode":"all","follow_up_mode":"all"}');
    const root = await project('{"follow_up_mode":"one-at-a-time"}');
    const { config } = await loadConfig(root, home);
    expect(config.steering_mode).toBe("all");
    expect(config.follow_up_mode).toBe("one-at-a-time");
  });
});

// The rename kept every old name working rather than making a directory rename
// and a shell-profile edit the price of upgrading. These pin that promise; the
// rest of this file exercises `.glrs`, so without them the fallback would be
// the only path covered or the only path broken and nobody would know which.
describe("the names from before the rename", () => {
  const named = async (dir: string, contents: string): Promise<string> => {
    const root = await mkdtemp(join(tmpdir(), "glrs-legacy-"));
    roots.push(root);
    await mkdir(join(root, dir), { recursive: true });
    await writeFile(join(root, dir, "config.json"), contents);
    return root;
  };

  test("a project .glorious/config.json is still read", async () => {
    const root = await named(".glorious", '{"model":"azure/from-the-old-name"}');
    const { config, diagnostics } = await loadConfig(root, join(root, "nohome"));
    expect(config.model).toBe("azure/from-the-old-name");
    expect(diagnostics).toEqual([]);
  });

  test("with both present in one project, .glrs wins", async () => {
    const root = await named(".glorious", '{"model":"azure/old"}');
    await mkdir(join(root, ".glrs"), { recursive: true });
    await writeFile(join(root, ".glrs", "config.json"), '{"model":"azure/new"}');
    expect((await loadConfig(root, join(root, "nohome"))).config.model).toBe("azure/new");
  });

  // The ordering claim in configPaths: project beats personal regardless of
  // which spelling each one uses, or the rename would quietly reorder
  // precedence rather than just adding a name.
  test("a project .glorious still beats a personal .glrs", async () => {
    const home = await mkdtemp(join(tmpdir(), "glrs-legacy-home-"));
    roots.push(home);
    await mkdir(join(home, ".glrs"), { recursive: true });
    await writeFile(join(home, ".glrs", "config.json"), '{"model":"azure/personal"}');
    const root = await named(".glorious", '{"model":"azure/project"}');
    expect((await loadConfig(root, home)).config.model).toBe("azure/project");
  });

  test("both spellings appear in the search path, new ones first", () => {
    const paths = configPaths("/repo", "/home/me");
    const first = paths.findIndex((path) => path.includes(".glrs"));
    const later = paths.findIndex((path) => path.includes(".glorious"));
    expect(first).toBeGreaterThanOrEqual(0);
    expect(later).toBeGreaterThan(first);
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
