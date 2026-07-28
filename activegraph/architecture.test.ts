/**
 * Mechanical enforcement of the hexagon. The layering rules the library is
 * built on are asserted against the actual import statements on disk, so a
 * violating import is a failing test, not a review comment:
 *
 *   domain/  -> zod + lib/fp + other domain modules ONLY (no bun:/node:,
 *               no ports, no adapters, no shell)
 *   ports/   -> domain types (+ lib) only
 *   adapters/-> anything except shell; only adapters may touch bun:/node:
 *   shell/runtime.ts -> ports only (composition roots defaults.ts/replay.ts
 *               are the sanctioned adapter-picking sites)
 */

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = import.meta.dir;

const sourcesIn = (dir: string): readonly { readonly file: string; readonly imports: string[] }[] =>
  readdirSync(join(root, dir))
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => {
      const text = readFileSync(join(root, dir, name), "utf8");
      const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((match) => match[1] ?? "");
      return { file: `${dir}/${name}`, imports };
    });

const offending = (
  files: readonly { readonly file: string; readonly imports: string[] }[],
  forbidden: (spec: string) => boolean,
): string[] =>
  files.flatMap(({ file, imports }) =>
    imports.filter(forbidden).map((spec) => `${file} imports ${spec}`),
  );

describe("the hexagon, mechanically", () => {
  test("domain imports only zod, lib, and other domain modules", () => {
    const violations = offending(
      sourcesIn("domain"),
      (spec) =>
        spec.startsWith("bun:") ||
        spec.startsWith("node:") ||
        spec.includes("/ports") ||
        spec.includes("/adapters") ||
        spec.includes("/shell") ||
        !(spec === "zod" || spec.startsWith("./") || spec.startsWith("../lib/")),
    );
    expect(violations).toEqual([]);
  });

  test("ports import only domain types and lib", () => {
    const violations = offending(
      sourcesIn("ports"),
      (spec) =>
        spec.startsWith("bun:") ||
        spec.startsWith("node:") ||
        spec.includes("/adapters") ||
        spec.includes("/shell") ||
        !(spec === "zod" || spec.startsWith("../domain/") || spec.startsWith("../lib/")),
    );
    expect(violations).toEqual([]);
  });

  test("adapters never import the shell", () => {
    const violations = offending(sourcesIn("adapters"), (spec) => spec.includes("/shell"));
    expect(violations).toEqual([]);
  });

  test("only adapters touch runtime-specific APIs (bun:/node: outside tests)", () => {
    const nonAdapterDirs = ["domain", "ports", "shell", "lib"];
    const violations = nonAdapterDirs.flatMap((dir) =>
      offending(sourcesIn(dir), (spec) => spec.startsWith("bun:") || spec.startsWith("node:")),
    );
    expect(violations).toEqual([]);
  });

  test("shell/runtime.ts speaks ports only — adapter picking is confined to composition roots", () => {
    const runtime = sourcesIn("shell").find((entry) => entry.file === "shell/runtime.ts");
    expect(runtime).toBeDefined();
    expect(runtime?.imports.filter((spec) => spec.includes("/adapters"))).toEqual([]);
  });
});
