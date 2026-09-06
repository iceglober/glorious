import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { writeArtifact } from "../../../glrs-core/src/session";
import compactionArtifacts from "./index";

// The core writes the files; this is the claim that the agent can reach them.

type Tool = { name: string; execute: (input: Record<string, unknown>) => Promise<string> };

let home = "";
let previous: string | undefined;
beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "glrs-ca-"));
  previous = process.env.XDG_DATA_HOME;
  process.env.XDG_DATA_HOME = home;
});
afterAll(async () => {
  if (previous === undefined) delete process.env.XDG_DATA_HOME;
  else process.env.XDG_DATA_HOME = previous;
  await rm(home, { recursive: true, force: true });
});

const harness = (sessionId: string) => {
  const tools = new Map<string, Tool>();
  const hooks = new Map<string, () => Promise<unknown>>();
  let prompt: () => string = () => "";
  const printed: string[] = [];
  const g = {
    z,
    tool: (spec: Tool) => tools.set(spec.name, spec),
    on: (name: string, handler: () => Promise<unknown>) => hooks.set(name, handler),
    prompt: (render: () => string) => {
      prompt = render;
    },
    command: () => {},
    print: (text: string) => printed.push(text),
    session: () => ({ id: sessionId, file: "", title: "", events: 0 }),
  };
  compactionArtifacts(g as never);
  const run = (name: string, input: Record<string, unknown> = {}) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`no tool ${name}`);
    return tool.execute(input);
  };
  return { run, hooks, prompt: () => prompt(), printed };
};

describe("reaching what a compaction replaced", () => {
  test("list, read, annotate, delete, in that order", async () => {
    const { run } = harness("s1");
    const made = await writeArtifact("s1", {
      label: "fixed the redirect",
      messages: [{ role: "user", content: "the exact error was ECONNREFUSED 127.0.0.1:5432" }],
    });
    expect(await run("compaction_list")).toContain("fixed the redirect");
    expect(await run("compaction_read", { id: made.id })).toContain("ECONNREFUSED 127.0.0.1:5432");
    expect(await run("compaction_annotate", { id: made.id, note: "db was down" })).toContain(
      "Updated",
    );
    expect(await run("compaction_list")).toContain("note: db was down");
    expect(await run("compaction_delete", { id: made.id })).toContain("Deleted");
    expect(await run("compaction_list")).toContain("No compaction artifacts");
  });

  test("a wrong id is an ERROR the model can read, not a throw", async () => {
    const { run } = harness("s2");
    expect(await run("compaction_read", { id: "nope" })).toStartWith("ERROR");
    expect(await run("compaction_delete", { id: "nope" })).toStartWith("ERROR");
  });

  test("annotating with nothing to change says so", async () => {
    const { run } = harness("s3");
    expect(await run("compaction_annotate", { id: "any" })).toContain("Nothing to change");
  });

  // A session that has never been compacted should not carry a line about
  // compaction on every turn.
  test("the prompt line appears only once something is kept", async () => {
    const { hooks, prompt } = harness("s4");
    await hooks.get("session_start")?.();
    expect(prompt()).toBe("");
    await writeArtifact("s4", { label: "x", messages: [{ role: "user", content: "y" }] });
    await hooks.get("compact")?.();
    expect(prompt()).toContain("1 earlier compaction");
    expect(prompt()).toContain("compaction_read");
  });
});
