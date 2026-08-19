import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ToolSpec } from "../../../glrs-core/src";
import { createCodingTools } from "./tools";

// These used to live in the coding agent, where they reached for `docsPath()`
// and `homedir()` to work out what was in scope. There is no scope any more —
// paths resolve and that is all — so what is left is behaviour a disposable
// directory can check.

const roots: string[] = [];

const project = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "glrs-tools-"));
  roots.push(root);
  return root;
};

const tools = (root: string): Record<string, ToolSpec> =>
  Object.fromEntries(createCodingTools(root).map((spec) => [spec.name, spec]));

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

describe("how a path is resolved", () => {
  test("a relative path resolves against the project root", async () => {
    const root = await project();
    const kit = tools(root);
    expect(await run(kit.write, { path: "note.txt", content: "hello\n" })).toBe("wrote note.txt");
    expect(await run(kit.read, { path: "note.txt" })).toContain("1|hello");
    expect(await Bun.file(join(root, "note.txt")).text()).toBe("hello\n");
  });

  // Nothing is refused. There was a path check on five of the six, with `bash`
  // sitting unconfined beside them — so it never bounded what the agent could
  // touch, it only made the model reach a file the slow way after being told no
  // on the direct one. glrs runs in YOLO mode; this is that, without the theatre.
  test("an absolute path outside the project is not refused", async () => {
    const root = await project();
    const elsewhere = await project();
    const kit = tools(root);
    expect(await run(kit.write, { path: join(elsewhere, "out.txt"), content: "yes\n" })).toBe(
      `wrote ${join(elsewhere, "out.txt")}`,
    );
    expect(await run(kit.read, { path: join(elsewhere, "out.txt") })).toContain("1|yes");
  });

  test("a relative path climbing out of the project is not refused either", async () => {
    const root = await project();
    const kit = tools(root);
    const said = await run(kit.read, { path: "../" });
    // A directory, so it fails on being a directory rather than on where it is.
    expect(said).not.toContain("escapes root");
  });

  test("edit reaches outside the project too", async () => {
    const root = await project();
    const elsewhere = await project();
    await writeFile(join(elsewhere, "far.txt"), "before\n");
    const kit = tools(root);
    const said = await run(kit.edit, {
      files: [
        {
          path: join(elsewhere, "far.txt"),
          edits: [{ old_string: "before", new_string: "after" }],
        },
      ],
    });
    expect(said).toContain("applied 1 edit");
    expect(await Bun.file(join(elsewhere, "far.txt")).text()).toBe("after\n");
  });
});

describe("searching a project", () => {
  test("grep finds a match and glob lists a file", async () => {
    const root = await project();
    await writeFile(join(root, "hay.txt"), "needle here\n");
    const kit = tools(root);
    expect(await run(kit.grep, { pattern: "needle" })).toContain("needle here");
    expect(await run(kit.glob, { pattern: "*.txt" })).toContain("hay.txt");
  });

  test("glob says so when the directory does not exist", async () => {
    const root = await project();
    const kit = tools(root);
    expect(await run(kit.glob, { pattern: "*", path: "nowhere" })).toStartWith(
      "ERROR: no such directory",
    );
  });
});

describe("running a command", () => {
  test("bash returns stdout, and the exit code when it fails", async () => {
    const root = await project();
    const kit = tools(root);
    expect(await run(kit.bash, { command: "echo hello" })).toBe("hello");
    expect(await run(kit.bash, { command: "exit 3" })).toContain("[exit 3]");
  });
});

describe("what the extension registers", () => {
  test("the six, by the names the prompts use", () => {
    const names = createCodingTools("/tmp").map((spec) => spec.name);
    expect(names).toEqual(["bash", "read", "write", "edit", "grep", "glob"]);
  });

  // resultSummary in the coding agent keys off these names for `432 lines` and
  // `2 matches`, and there is no renderResult here to take over if they drift.
  test("none of them draws its own result row", () => {
    for (const spec of createCodingTools("/tmp")) expect(spec.renderResult).toBeUndefined();
  });
});
