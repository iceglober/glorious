import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { availableLines } from "./available";
import { shippedExtensions } from "./extensions";

// The three states come from config rather than a store of their own: named in
// `extensions.load` is a yes, named in `extensions.disable` is a no, in neither
// is a question nobody has answered.
describe("which shipped extensions are still undecided", () => {
  const state = (name: string, settings?: Parameters<typeof shippedExtensions>[0]): string =>
    shippedExtensions(settings).find((one) => one.name === name)?.state ?? "missing";

  test("with no config, builtins is on and the rest are undecided", () => {
    expect(state("builtins")).toBe("on");
    expect(state("web-fetch")).toBe("undecided");
    expect(state("ask-user")).toBe("undecided");
  });

  test("naming one in load makes it on", () => {
    expect(state("web-fetch", { load: ["web-fetch"] })).toBe("on");
  });

  test("naming one in disable makes it off, including the one that defaults on", () => {
    expect(state("web-fetch", { disable: ["web-fetch"] })).toBe("off");
    expect(state("builtins", { disable: ["builtins"] })).toBe("off");
  });

  test("the package specifier counts as naming it", () => {
    expect(state("web-fetch", { load: ["@glrs-dev/glrs-ext-web-fetch"] })).toBe("on");
  });

  test("disable beats load, the same way the loader resolves it", () => {
    expect(state("web-fetch", { load: ["web-fetch"], disable: ["web-fetch"] })).toBe("off");
  });
});

describe("what the model is told about what it could have", () => {
  const shipped = (states: Array<"on" | "off" | "undecided">) =>
    states.map((state, at) => ({ name: `ext-${at}`, summary: `does thing ${at}`, state }));

  test("an undecided extension is named, with what it is for", () => {
    const lines = availableLines(shipped(["undecided"]), true).join("\n");
    expect(lines).toContain("ext-0 — does thing 0");
  });

  // The section disappearing is the point. An agent that keeps offering
  // something you already declined is worse than one that never offered.
  test("nothing is said once every one has been decided", () => {
    expect(availableLines(shipped(["on", "off"]), true)).toEqual([]);
    expect(availableLines([], true)).toEqual([]);
  });

  test("neither the ones already on nor the ones turned off are offered", () => {
    const lines = availableLines(shipped(["on", "off", "undecided"]), true).join("\n");
    expect(lines).toContain("ext-2");
    expect(lines).not.toContain("ext-0 —");
    expect(lines).not.toContain("ext-1 —");
  });

  // Without somewhere to write the answer, a decline lasts until the next turn.
  // So what the model is told to do about an answer depends on whether it can
  // record one.
  test("it is pointed at the tool only when the answer can be recorded", () => {
    expect(availableLines(shipped(["undecided"]), true).join("\n")).toContain(
      "configure_extension",
    );
    const cannot = availableLines(shipped(["undecided"]), false).join("\n");
    expect(cannot).not.toContain("configure_extension");
    expect(cannot).toContain("agentConfigAllowlist");
  });
});

// The caching guarantee, pinned structurally because it is invisible at
// runtime: the advertisement changes between turns, and if it were in the
// system prompt the provider's cache would miss on every one of them.
//
// Read from source rather than exercised, because the failure this rules out
// is somebody moving one call in index.ts — which no assertion about output
// would notice, since both paths reach the model.
describe("where the advertisement is allowed to go", () => {
  const source = readFileSync(join(import.meta.dir, "index.ts"), "utf8");

  test("it rides extensionPrompt, which is rebuilt per turn", () => {
    const at = source.indexOf("extensionPrompt:");
    expect(at).toBeGreaterThan(-1);
    // Inside the extensionPrompt property, not somewhere else in the file.
    expect(source.slice(at, at + 400)).toContain("availableLines");
  });

  test("nothing in the prompt module knows about it", () => {
    // systemPrompt is the byte-identical part. If availableLines ever reaches
    // prompt.ts, the cache is gone and nothing else would say so.
    const prompt = readFileSync(join(import.meta.dir, "prompt.ts"), "utf8");
    expect(prompt).not.toContain("availableLines");
    expect(prompt).not.toContain("shippedExtensions");
  });

  // <extensions> is already a PREAMBLE_TAG, which is what strips the block from
  // a replayed transcript. Riding it means no new tag and no stripping change.
  test("it goes in a block the transcript already knows to strip", () => {
    const tags = readFileSync(
      join(import.meta.dir, "..", "..", "glrs-core", "src", "events.ts"),
      "utf8",
    );
    expect(tags).toContain('"extensions"');
  });
});
