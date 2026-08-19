import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Scope, ToolSpec } from "../../../glrs-core/src";
import { createCodingTools } from "./tools";

// These used to live in the coding agent and reach for `docsPath()` and
// `homedir()` to work out what was in scope. The tools take a scope now instead
// of computing one, which is what lets this hand them a disposable directory
// and stop depending on where the machine running the test keeps its home.

const roots: string[] = [];

const project = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "glrs-tools-"));
  roots.push(root);
  return root;
};

const tools = (root: string, scope: Scope): Record<string, ToolSpec> =>
  Object.fromEntries(createCodingTools(root, scope).map((spec) => [spec.name, spec]));

const run = async (spec: ToolSpec | undefined, input: Record<string, unknown>): Promise<string> => {
  if (spec === undefined) return "ERROR: no such tool";
  // Parsed through the tool's own schema first, exactly as the model's call is
  // before it ever reaches `execute`. Skipping it silently drops the schema's
  // defaults — `maxResults` becomes undefined, the line cap becomes NaN, and
  // ripgrep is SIGTERMed the moment it prints anything.
  //
  // wrapTool turns the throw into the "ERROR: …" string the model reads; these
  // specs are raw, so the harness does that one thing too.
  try {
    return await spec.execute(spec.input.parse(input), undefined);
  } catch (thrown) {
    return `ERROR: ${thrown instanceof Error ? thrown.message : String(thrown)}`;
  }
};

afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe("what the six tools can reach", () => {
  test("a file inside the project is readable and writable", async () => {
    const root = await project();
    const kit = tools(root, { read: [], write: [] });
    expect(await run(kit.write, { path: "note.txt", content: "hello\n" })).toBe("wrote note.txt");
    expect(await run(kit.read, { path: "note.txt" })).toContain("1|hello");
  });

  // Reads reach one place writes do not: the system prompt hands the model an
  // absolute path to glrs's own documentation and tells it to read it.
  test("read reaches the read scope and write does not", async () => {
    const root = await project();
    const elsewhere = await project();
    await writeFile(join(elsewhere, "doc.md"), "documentation\n");
    const kit = tools(root, { read: [elsewhere], write: [] });

    expect(await run(kit.read, { path: join(elsewhere, "doc.md") })).toContain("documentation");
    expect(await run(kit.write, { path: join(elsewhere, "new.md"), content: "no" })).toContain(
      "path escapes root",
    );
  });

  test("write reaches the write scope", async () => {
    const root = await project();
    const elsewhere = await project();
    const kit = tools(root, { read: [elsewhere], write: [elsewhere] });
    expect(await run(kit.write, { path: join(elsewhere, "ext.ts"), content: "// probe\n" })).toBe(
      `wrote ${join(elsewhere, "ext.ts")}`,
    );
  });

  test("neither reaches anywhere outside both", async () => {
    const root = await project();
    const kit = tools(root, { read: [], write: [] });
    expect(await run(kit.read, { path: "/etc/hosts" })).toContain("path escapes root");
    expect(await run(kit.write, { path: "/tmp/zz-nope.txt", content: "no" })).toContain(
      "path escapes root",
    );
  });

  // The grant is the entries themselves, not their parents. A scope naming
  // ~/.glrs/extensions must not carry ~/.glrs with it — that directory is
  // where at least one person keeps their checkouts.
  test("the parent of a scope entry is not in scope", async () => {
    const root = await project();
    const home = await project();
    const kit = tools(root, {
      read: [join(home, "extensions")],
      write: [join(home, "extensions")],
    });
    await mkdir(join(home, "extensions"), { recursive: true });
    expect(await run(kit.write, { path: join(home, "extensions", "a.ts"), content: "//\n" })).toBe(
      `wrote ${join(home, "extensions", "a.ts")}`,
    );
    expect(await run(kit.write, { path: join(home, "loose.txt"), content: "no" })).toContain(
      "path escapes root",
    );
  });

  test("a sibling whose name merely starts the same is not in scope", async () => {
    const root = await project();
    const kit = tools(root, { read: ["/tmp/glrs-scope"], write: ["/tmp/glrs-scope"] });
    expect(await run(kit.read, { path: "/tmp/glrs-scope-other/x" })).toContain("path escapes root");
  });
});

describe("searching a project", () => {
  test("grep finds a match and glob lists a file", async () => {
    const root = await project();
    await writeFile(join(root, "hay.txt"), "needle here\n");
    const kit = tools(root, { read: [], write: [] });
    expect(await run(kit.grep, { pattern: "needle" })).toContain("needle here");
    expect(await run(kit.glob, { pattern: "*.txt" })).toContain("hay.txt");
  });

  test("glob says so when the directory does not exist", async () => {
    const root = await project();
    const kit = tools(root, { read: [], write: [] });
    expect(await run(kit.glob, { pattern: "*", path: "nowhere" })).toStartWith(
      "ERROR: no such directory",
    );
  });
});

describe("running a command", () => {
  test("bash returns stdout, and the exit code when it fails", async () => {
    const root = await project();
    const kit = tools(root, { read: [], write: [] });
    expect(await run(kit.bash, { command: "echo hello" })).toBe("hello");
    expect(await run(kit.bash, { command: "exit 3" })).toContain("[exit 3]");
  });
});

describe("what the extension registers", () => {
  test("the six, by the names the prompts use", () => {
    const names = createCodingTools("/tmp", { read: [], write: [] }).map((spec) => spec.name);
    expect(names).toEqual(["bash", "read", "write", "edit", "grep", "glob"]);
  });

  // resultSummary in the coding agent keys off these names for `432 lines` and
  // `2 matches`, and there is no renderResult here to take over if they drift.
  test("none of them draws its own result row", () => {
    for (const spec of createCodingTools("/tmp", { read: [], write: [] }))
      expect(spec.renderResult).toBeUndefined();
  });
});
