import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configPaths, loadConfig } from "./config";

const roots: string[] = [];

const project = async (contents: string | null): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "glorious-config-"));
  roots.push(root);
  if (contents !== null) {
    await mkdir(join(root, ".glorious"), { recursive: true });
    await writeFile(join(root, ".glorious", "config.json"), contents);
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

  // A config file that grew a key glorious no longer knows about is not broken.
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

// Extensions, sequences and commands already come from ~/.glorious — the
// ancestor walk reaches it whenever a project sits under home. Config not
// reading the same directory is a rule nobody should have to learn.
describe("where personal config lives", () => {
  test("both personal locations are read, project first", () => {
    const paths = configPaths("/zz/project", "/zz/home");
    // the copy you do not commit sits nearest, ahead of the one you do
    expect(paths[0]).toBe("/zz/project/.glorious/config.local.json");
    expect(paths[1]).toBe("/zz/project/.glorious/config.json");
    expect(paths).toContain("/zz/home/.glorious/config.json");
    expect(paths).toContain("/zz/home/.config/glorious/config.json");
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
    const dir = await mkdtemp(join(tmpdir(), "glorious-local-"));
    await mkdir(join(dir, ".glorious"), { recursive: true });
    await writeFile(join(dir, ".glorious", "config.json"), '{"model":"azure/committed"}');
    await writeFile(join(dir, ".glorious", "config.local.json"), '{"model":"azure/mine"}');
    const { config } = await loadConfig(dir, join(dir, "nohome"));
    expect(config.model).toBe("azure/mine");
    await rm(dir, { recursive: true, force: true });
  });

  test("the .local. copy still layers, rather than replacing the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glorious-local-"));
    await mkdir(join(dir, ".glorious"), { recursive: true });
    await writeFile(
      join(dir, ".glorious", "config.json"),
      '{"model":"azure/committed","variant":"high"}',
    );
    await writeFile(join(dir, ".glorious", "config.local.json"), '{"model":"azure/mine"}');
    const { config } = await loadConfig(dir, join(dir, "nohome"));
    expect(config).toMatchObject({ model: "azure/mine", variant: "high" });
    await rm(dir, { recursive: true, force: true });
  });

  // The key was recognised and the value was the wrong type, so it was dropped
  // exactly as silently as a typo.
  test("a recognised key of the wrong type says so", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glorious-shape-"));
    await mkdir(join(dir, ".glorious"), { recursive: true });
    await writeFile(
      join(dir, ".glorious", "config.json"),
      '{"model":{"selected":"azure/gpt-5.6-sol"}}',
    );
    const { config, diagnostics } = await loadConfig(dir, join(dir, "nohome"));
    expect(config.model).toBeUndefined();
    expect(diagnostics.join("\n")).toContain('"model" should be a string');
    await rm(dir, { recursive: true, force: true });
  });

  test("a file written for something else says the whole thing is ignored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glorious-alien-"));
    await mkdir(join(dir, ".glorious"), { recursive: true });
    await writeFile(
      join(dir, ".glorious", "config.json"),
      '{"agent":{"llm":{"model":"gpt-5.6-luna"}},"permissions":{}}',
    );
    const { diagnostics } = await loadConfig(dir, join(dir, "nohome"));
    expect(diagnostics.join("\n")).toContain("nothing here is a glorious setting");
    await rm(dir, { recursive: true, force: true });
  });

  test("an empty object is a real config, not a mistake", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glorious-empty-"));
    await mkdir(join(dir, ".glorious"), { recursive: true });
    await writeFile(join(dir, ".glorious", "config.json"), "{}");
    expect((await loadConfig(dir, join(dir, "nohome"))).diagnostics).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });

  test("a good config says nothing at all", async () => {
    const dir = await mkdtemp(join(tmpdir(), "glorious-good-"));
    await mkdir(join(dir, ".glorious"), { recursive: true });
    await writeFile(
      join(dir, ".glorious", "config.json"),
      '{"model":"azure/gpt-5.6-sol","providers":{"azure":{"api":"https://x"}}}',
    );
    const { config, diagnostics } = await loadConfig(dir, join(dir, "nohome"));
    expect(config.model).toBe("azure/gpt-5.6-sol");
    expect(diagnostics.filter((one) => one.includes(".glorious/config.json"))).toEqual([]);
    await rm(dir, { recursive: true, force: true });
  });
});
