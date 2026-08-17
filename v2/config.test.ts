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
  test("reads the model and variant a project pins", async () => {
    const root = await project(`{"model":"anthropic/claude-opus-5","variant":"high"}`);
    expect((await loadConfig(root)).config).toMatchObject({
      model: "anthropic/claude-opus-5",
      variant: "high",
    });
  });

  test("a missing config is not a problem", async () => {
    const { config, diagnostics } = await loadConfig(await project(null));
    expect(config.model).toBeUndefined();
    expect(diagnostics).toEqual([]);
  });

  // A config that silently does nothing is the hardest kind to debug, so a
  // broken one is reported — and the session still starts.
  test("malformed JSON is reported, not swallowed, and does not throw", async () => {
    const { config, diagnostics } = await loadConfig(await project("{not json"));
    expect(config.model).toBeUndefined();
    expect(diagnostics[0]).toContain("not valid JSON");
  });

  // A config file that grew a key glorious no longer knows about is not broken.
  // Refusing to start over one would be the worse failure.
  test("unknown keys are ignored rather than rejected", async () => {
    const root = await project(`{"model":"azure/x","mcpServers":{"old":{}},"nonsense":1}`);
    const { config, diagnostics } = await loadConfig(root);
    expect(config.model).toBe("azure/x");
    expect(diagnostics).toEqual([]);
  });

  test("provider settings survive, keyed by provider", async () => {
    const root = await project(`{"providers":{"google-vertex":{"project":"p","location":"l"}}}`);
    expect((await loadConfig(root)).config.providers).toEqual({
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
    const paths = configPaths("/zz/project");
    expect(paths[0]).toBe("/zz/project/.glorious/config.json");
    expect(paths.some((path) => path.endsWith("/.glorious/config.json") && path !== paths[0])).toBe(
      true,
    );
    expect(paths.some((path) => path.includes("/.config/glorious/"))).toBe(true);
  });

  test("a project pins one key while personal config supplies another", async () => {
    const root = await project(`{"model":"anthropic/claude-opus-5"}`);
    const { config } = await loadConfig(root);
    expect(config.model).toBe("anthropic/claude-opus-5");
  });
});
