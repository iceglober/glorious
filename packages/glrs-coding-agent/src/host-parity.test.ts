import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// These read host source directly, so they live with the hosts. The runtime
// they are checking is in glrs-core; what they assert is that this product's
// three hosts and its renderer keep faith with it.
const here = import.meta.dir;
const core = join(here, "..", "..", "glrs-core", "src");

describe("every event fires in both hosts", () => {
  const TUI_ONLY: Record<string, string> = {
    input: "there is no composer to type into headlessly",
    user_bash: "`!` is a composer key",
    model_select: "a one-shot run cannot switch models",
    compact: "a one-shot run never compacts",
    session_before_compact: "a one-shot run never compacts",
    session_before_switch: "a one-shot run has no session to switch",
    session_before_fork: "a one-shot run has no session to fork",
  };

  const names = (): string[] => {
    const source =
      readFileSync(join(core, "extension-api.ts"), "utf8") +
      readFileSync(join(core, "index.ts"), "utf8");
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

describe("what the renderer draws is what the type allows", () => {
  const coreTypes = readFileSync(join(core, "index.ts"), "utf8");
  const render = readFileSync(join(here, "render.ts"), "utf8");

  test("every tone the renderer paints can be named by an extension", () => {
    const painted = [
      ...render.matchAll(/^ {2}(accent|highlight|muted|prompt|success|warning|danger):/gmu),
    ].map((one) => one[1]);
    const declared = coreTypes.slice(
      coreTypes.indexOf("export type Tone ="),
      coreTypes.indexOf(";", coreTypes.indexOf("export type Tone =")),
    );
    for (const tone of new Set(painted)) expect(declared).toContain(`"${tone}"`);
  });

  test("neither is declared twice", () => {
    expect(render).not.toMatch(/^export type Tone =/mu);
    expect(render).not.toMatch(/^export type Span = \{/mu);
  });

  test("span attributes the renderer honours are on the type", () => {
    const span = coreTypes.slice(coreTypes.indexOf("export type Span = {"));
    for (const attribute of ["bold", "italic", "underline", "fill"])
      expect(span.slice(0, span.indexOf("};"))).toContain(attribute);
  });
});
