import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  configLayerPath,
  configProvenance,
  loadConfig,
  mergeConfig,
  writeConfigLayer,
} from "./config";

const directories: string[] = [];

const directory = async (): Promise<string> => {
  const path = await mkdtemp(join(tmpdir(), "glorious-config-"));
  directories.push(path);
  return path;
};

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

const writeJson = (path: string, value: unknown): Promise<void> =>
  writeFile(path, `${JSON.stringify(value)}\n`);

describe("layered config", () => {
  test("merges layers in precedence order and reports the source", async () => {
    const root = await directory();
    const globalPath = join(root, "global.json");
    await writeJson(globalPath, {
      model: { selected: "global/model", variant: "low" },
      providers: { vertex: { project: "global-project", region: "us" } },
    });
    await mkdir(join(root, ".glorious"));
    await writeJson(join(root, ".glorious/config.json"), {
      model: { variant: "high" },
      providers: { vertex: { location: "us-central1" } },
    });
    await writeJson(join(root, ".glorious/config.local.json"), {
      model: { selected: "local/model" },
      providers: { vertex: { project: "local-project" } },
    });

    const loaded = await loadConfig(root, { globalPath });

    expect(loaded.config).toEqual({
      model: { selected: "local/model", variant: "high" },
      providers: {
        vertex: { project: "local-project", region: "us", location: "us-central1" },
      },
    });
    expect(configProvenance(loaded.layers, "model.selected")).toBe("local");
    expect(configProvenance(loaded.layers, ["model", "variant"])).toBe("project");
    expect(configProvenance(loaded.layers, "providers.vertex.region")).toBe("global");
  });

  test("replaces arrays and scalar values during a pure merge", () => {
    const first = { value: ["one"], nested: { keep: true, replace: "old" } };
    const merged = mergeConfig(first, { value: ["two"], nested: { replace: "new" } });

    expect(merged).toEqual({ value: ["two"], nested: { keep: true, replace: "new" } });
    expect(first).toEqual({ value: ["one"], nested: { keep: true, replace: "old" } });
  });

  test("keeps loading when files are missing or malformed", async () => {
    const root = await directory();
    const globalPath = join(root, "global.json");
    await writeFile(globalPath, "{");

    const loaded = await loadConfig(root, { globalPath });

    expect(loaded.config).toEqual({ model: {}, providers: {} });
    expect(loaded.diagnostics.map((diagnostic) => diagnostic.kind)).toEqual([
      "malformed",
      "missing",
      "missing",
    ]);
  });

  test("rejects api keys and secrets from files and writes", async () => {
    const root = await directory();
    const globalPath = join(root, "global.json");
    await writeJson(globalPath, { providers: { openai: { apiKey: "secret" } } });

    const loaded = await loadConfig(root, { globalPath });
    expect(loaded.diagnostics[0]?.kind).toBe("invalid");
    expect(loaded.config.providers).toEqual({});

    await expect(
      writeConfigLayer("global", root, { secrets: { openai: "secret" } } as never, {
        globalPath,
      }),
    ).rejects.toThrow();
  });

  test("validates before atomically replacing a writable layer", async () => {
    const root = await directory();
    const globalPath = join(root, "global.json");
    await writeJson(globalPath, { model: { selected: "before" } });

    await expect(
      writeConfigLayer("global", root, { model: { selected: 1 } } as never, { globalPath }),
    ).rejects.toThrow();
    expect(await readFile(globalPath, "utf8")).toBe('{"model":{"selected":"before"}}\n');

    const events: string[] = [];
    await writeConfigLayer(
      "project",
      root,
      { model: { selected: "after" } },
      {
        fileSystem: {
          readFile: (path) => readFile(path, "utf8"),
          mkdir: async (path, options) => {
            await mkdir(path, options);
          },
          writeFile: async (path, contents, options) => {
            events.push("write");
            await writeFile(path, contents, options);
          },
          rename: async (from, to) => {
            events.push("rename");
            await rename(from, to);
          },
          rm: (path, options) => rm(path, options),
        },
      },
    );
    const projectPath = configLayerPath("project", root);
    expect(events).toEqual(["write", "rename"]);
    expect(JSON.parse(await readFile(projectPath, "utf8"))).toEqual({
      model: { selected: "after" },
    });
  });
});
