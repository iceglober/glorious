import { afterEach, describe, expect, test } from "bun:test";
import { z } from "zod";
import { nextToolEventId, resultSummary, setToolGate, type ToolEvent, wrapTool } from "./toolkit";

// What every tool call goes through, whoever defined the tool. The six that
// touch the machine are the builtins extension now and are tested there; this
// is the machinery they and an extension's tools share.

const probe = (onEvent: (event: ToolEvent) => void = () => {}, body = async () => "ok") =>
  wrapTool(onEvent, "probe", "d", z.object({}), body);

describe("one event counter for the whole process", () => {
  // chat.ts pairs start with end by id inside a turn, and a turn can be running
  // the parent's tools and several subagents' at once. A per-instance counter
  // made those collide.
  test("ids keep increasing across separately built tools", async () => {
    const seen: number[] = [];
    const record = (event: ToolEvent): void => {
      if (event.phase === "start") seen.push(event.id);
    };
    const first = probe(record);
    const second = probe(record);
    await (first.execute as (i: unknown, c: unknown) => Promise<string>)({}, {});
    await (second.execute as (i: unknown, c: unknown) => Promise<string>)({}, {});
    expect(seen).toHaveLength(2);
    expect(seen[1]).toBeGreaterThan(seen[0] ?? 0);
  });

  test("the counter is never handed the same number twice", () => {
    expect(nextToolEventId()).toBeLessThan(nextToolEventId());
  });
});

describe("the tool gate", () => {
  const run = async (input: Record<string, unknown> = {}): Promise<string> => {
    const tool = wrapTool(
      () => {},
      "probe",
      "d",
      z.object({}),
      async () => "real result",
    );
    const execute = tool.execute as (i: unknown, c: unknown) => Promise<string>;
    return execute(input, {});
  };

  afterEach(() => setToolGate(null));

  test("with no gate the tool runs and its result is untouched", async () => {
    expect(await run()).toBe("real result");
  });

  test("before() refuses the call, and the body never runs", async () => {
    let ran = false;
    setToolGate({
      before: async () => "ERROR: blocked by policy",
      after: async () => undefined,
    });
    const tool = wrapTool(
      () => {},
      "probe",
      "d",
      z.object({}),
      async () => {
        ran = true;
        return "real result";
      },
    );
    const execute = tool.execute as (i: unknown, c: unknown) => Promise<string>;
    expect(await execute({}, {})).toBe("ERROR: blocked by policy");
    expect(ran).toBe(false);
  });

  test("a refusal still emits both phases, so the row is not left running", async () => {
    const events: ToolEvent[] = [];
    setToolGate({ before: async () => "ERROR: no", after: async () => undefined });
    const tool = wrapTool(
      (e) => events.push(e),
      "probe",
      "d",
      z.object({}),
      async () => "x",
    );
    await (tool.execute as (i: unknown, c: unknown) => Promise<string>)({}, {});
    expect(events.map((event) => event.phase)).toEqual(["start", "end"]);
    expect(events.filter((event) => event.phase === "end")).toMatchObject([{ ok: false }]);
  });

  test("after() rewrites what the model is told came back", async () => {
    setToolGate({
      before: async () => undefined,
      after: async (_name, _input, _ok, result) => `${result} [annotated]`,
    });
    expect(await run()).toBe("real result [annotated]");
  });

  test("after() sees whether the call succeeded", async () => {
    let seen: boolean | undefined;
    setToolGate({
      before: async () => undefined,
      after: async (_n, _i, ok) => {
        seen = ok;
        return undefined;
      },
    });
    const tool = wrapTool(
      () => {},
      "probe",
      "d",
      z.object({}),
      async () => "ERROR: nope",
    );
    await (tool.execute as (i: unknown, c: unknown) => Promise<string>)({}, {});
    expect(seen).toBe(false);
  });
});

// The row shows what a call is worth saying about its own result, not the tail
// of it: `432 lines` is what you want from a read, and the last three lines of
// a file are not.
describe("what a call says about its result", () => {
  test("a read reports its size, not its last line", () => {
    const file = Array.from({ length: 432 }, (_, at) => `${at + 1}|code`).join("\n");
    expect(resultSummary("read", file, true)).toBe("432 lines");
  });

  test("one line of anything is its own summary", () => {
    expect(resultSummary("write", "wrote v2/render.ts", true)).toBe("wrote v2/render.ts");
    expect(resultSummary("edit", "applied 2 edit(s) to a.ts", true)).toBe(
      "applied 2 edit(s) to a.ts",
    );
  });

  test("a search counts what it found", () => {
    expect(resultSummary("grep", "a.ts:1:x\nb.ts:2:y", true)).toBe("2 matches");
    expect(resultSummary("glob", "a.ts", true)).toBe("1 file");
  });

  // The count would otherwise be one too many: these lines are prose about the
  // result rather than part of it.
  test("a truncation notice is not counted as a match", () => {
    expect(resultSummary("grep", "a.ts:1:x\n[truncated at 1 matches]", true)).toBe("1 match");
  });

  test("nothing found reads as nothing found, not as zero", () => {
    expect(resultSummary("grep", "No matches.", true)).toBe("No matches");
  });

  test("a command is summarised by how it ended", () => {
    expect(resultSummary("bash", "compiling\nlinking\nBuild succeeded", true)).toBe(
      "Build succeeded",
    );
  });

  // A failed call puts its reason on its own line, so the row saying it too
  // would be saying it twice.
  test("a failure says nothing here", () => {
    expect(resultSummary("bash", "ERROR: no such file", false)).toBe("");
  });

  test("an empty result says nothing rather than guessing", () => {
    expect(resultSummary("bash", "", true)).toBe("");
  });
});
