import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Config } from "../../provider-registry/src";
import { recordExtensionChoice, recordModelChoice } from "./writeconfig";

// The one thing in glrs that writes your configuration. config.ts opens with
// "nothing writes config at runtime any more — you edit the file", and that
// stays true unless agentConfigAllowlist says otherwise. These pin the gate.

const roots: string[] = [];
const allowed: Config = { agentConfigAllowlist: ["extensions"] };

const project = async (contents?: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "glrs-write-"));
  roots.push(root);
  if (contents !== undefined) {
    await mkdir(join(root, ".glrs"), { recursive: true });
    await writeFile(join(root, ".glrs", "config.json"), contents);
  }
  return root;
};

const read = async (root: string): Promise<Record<string, unknown>> =>
  JSON.parse(await readFile(join(root, ".glrs", "config.json"), "utf8"));

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("permission to write your config", () => {
  test("without the allowlist, nothing is written", async () => {
    const root = await project('{"model":"azure/x"}');
    expect(await recordExtensionChoice(root, {}, "web-fetch", true)).toBe("not-allowed");
    expect(await read(root)).toEqual({ model: "azure/x" });
  });

  test("an allowlist naming something else does not open the door", async () => {
    const root = await project("{}");
    const other: Config = { agentConfigAllowlist: ["providers"] };
    expect(await recordExtensionChoice(root, other, "web-fetch", true)).toBe("not-allowed");
  });

  test("with the allowlist, the name lands in load", async () => {
    const root = await project("{}");
    expect(await recordExtensionChoice(root, allowed, "web-fetch", true)).toBe("written");
    expect(await read(root)).toMatchObject({ extensions: { load: ["web-fetch"], disable: [] } });
  });
});

describe("what recording a choice does to the file", () => {
  test("declining puts it in disable instead", async () => {
    const root = await project("{}");
    await recordExtensionChoice(root, allowed, "ask-user", false);
    expect(await read(root)).toMatchObject({ extensions: { load: [], disable: ["ask-user"] } });
  });

  // Answering the other way later has to actually change the answer, or the
  // name sits in both lists and `disable` quietly wins forever.
  test("changing your mind moves it between the lists", async () => {
    const root = await project("{}");
    await recordExtensionChoice(root, allowed, "web-fetch", false);
    expect(await recordExtensionChoice(root, allowed, "web-fetch", true)).toBe("written");
    const config = (await read(root)).extensions as { load: string[]; disable: string[] };
    expect(config.load).toEqual(["web-fetch"]);
    expect(config.disable).toEqual([]);
  });

  test("saying the same thing twice is a no-op, not a rewrite", async () => {
    const root = await project("{}");
    await recordExtensionChoice(root, allowed, "web-fetch", true);
    expect(await recordExtensionChoice(root, allowed, "web-fetch", true)).toBe("already");
  });

  test("every other key in the file survives", async () => {
    const root = await project('{"model":"azure/x","tools":{"disable":["write"]}}');
    await recordExtensionChoice(root, allowed, "web-fetch", true);
    const config = await read(root);
    expect(config.model).toBe("azure/x");
    expect(config.tools).toEqual({ disable: ["write"] });
  });

  test("a config file that does not exist yet is created", async () => {
    const root = await project();
    expect(await recordExtensionChoice(root, allowed, "web-fetch", true)).toBe("written");
    expect(await read(root)).toMatchObject({ extensions: { load: ["web-fetch"] } });
  });

  // A file that is not JSON is one someone is midway through editing.
  // Rewriting it would throw their work away — but the choice still has to be
  // recorded somewhere, so it starts from empty rather than clobbering.
  test("a half-edited file is not parsed into nonsense", async () => {
    const root = await project('{"model": "azure/x"');
    expect(await recordExtensionChoice(root, allowed, "web-fetch", true)).toBe("written");
    expect((await read(root)).extensions).toMatchObject({ load: ["web-fetch"] });
  });
});

// The model picker records what you chose, so a session that opened without one
// does not ask again on every launch. Same gate, its own section.
describe("keeping the model you chose", () => {
  const mayWriteModel: Config = { agentConfigAllowlist: ["model"] };

  test("the extensions section does not open this door", async () => {
    const root = await project("{}");
    expect(await recordModelChoice(root, allowed, "anthropic/claude-opus-5")).toBe("not-allowed");
    expect(await read(root)).toEqual({});
  });

  test("model and variant are written together", async () => {
    const root = await project("{}");
    expect(await recordModelChoice(root, mayWriteModel, "anthropic/claude-opus-5", "high")).toBe(
      "written",
    );
    expect(await read(root)).toEqual({ model: "anthropic/claude-opus-5", variant: "high" });
  });

  // An absent key and a null one read the same to config, and only one of them
  // is what a person would have typed.
  test("choosing the default effort removes the variant rather than nulling it", async () => {
    const root = await project('{"model":"openai/gpt-5.2","variant":"high"}');
    expect(await recordModelChoice(root, mayWriteModel, "anthropic/claude-opus-5")).toBe("written");
    expect(await read(root)).toEqual({ model: "anthropic/claude-opus-5" });
  });

  test("every other key in the file survives", async () => {
    const root = await project('{"$schema":"x","tools":{"disable":["write"]}}');
    await recordModelChoice(root, mayWriteModel, "anthropic/claude-opus-5");
    expect(await read(root)).toEqual({
      $schema: "x",
      tools: { disable: ["write"] },
      model: "anthropic/claude-opus-5",
    });
  });

  test("saying the same thing twice is a no-op, not a rewrite", async () => {
    const root = await project('{"model":"anthropic/claude-opus-5"}');
    expect(await recordModelChoice(root, mayWriteModel, "anthropic/claude-opus-5")).toBe("already");
  });

  test("the same model at a different effort is a change", async () => {
    const root = await project('{"model":"anthropic/claude-opus-5"}');
    expect(await recordModelChoice(root, mayWriteModel, "anthropic/claude-opus-5", "high")).toBe(
      "written",
    );
  });
});
