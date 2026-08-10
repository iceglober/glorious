import { describe, expect, test } from "bun:test";
import { allowedTools } from "./agent";
import { DEFAULT_MODE, MODES, type Mode, modeByName } from "./modes";
import { modePrompt, PREAMBLE_TAGS, systemPrompt } from "./prompt";
import { statusLine } from "./render";
import { BUILT_IN_TOOL_NAMES, READ_ONLY_TOOL_NAMES } from "./tools";

describe("the mode table", () => {
  test("build is the default and restricts nothing", () => {
    expect(DEFAULT_MODE.name).toBe("build");
    expect(DEFAULT_MODE.readOnly).toBe(false);
  });

  test("plan is read-only", () => {
    expect(modeByName("plan")?.readOnly).toBe(true);
  });

  test("lookup is case-insensitive and rejects an unknown name", () => {
    expect(modeByName("PLAN")?.name).toBe("plan");
    expect(modeByName("nonsense")).toBeUndefined();
  });

  test("every mode has a description, since the picker shows it", () => {
    for (const mode of MODES) expect(mode.description.length).toBeGreaterThan(10);
  });
});

describe("the read-only tool policy", () => {
  const withheld = BUILT_IN_TOOL_NAMES.filter(
    (name) => !(READ_ONLY_TOOL_NAMES as readonly string[]).includes(name),
  );

  test("withholds everything that can change the project", () => {
    for (const name of ["write", "edit"]) expect(withheld as readonly string[]).toContain(name);
  });

  test("withholds bash, which cannot be made read-only", () => {
    // `ls` and `rm -rf` are indistinguishable before running them
    expect(withheld as readonly string[]).toContain("bash");
  });

  test("withholds delegation, since a subagent would not be restricted", () => {
    expect(withheld as readonly string[]).toContain("run_subagent");
  });

  test("keeps the tools an agent needs to understand and ask", () => {
    for (const name of ["read", "grep", "glob", "ask_user"])
      expect(READ_ONLY_TOOL_NAMES as readonly string[]).toContain(name);
  });

  test("every read-only name is a real tool", () => {
    for (const name of READ_ONLY_TOOL_NAMES)
      expect(BUILT_IN_TOOL_NAMES as readonly string[]).toContain(name);
  });
});

describe("what the model is told", () => {
  test("build says nothing, so the common case costs no tokens", () => {
    expect(modePrompt({ name: "build", readOnly: false })).toBe("");
  });

  test("plan explains the restriction rather than leaving tools mysteriously absent", () => {
    const block = modePrompt({ name: "plan", readOnly: true });
    expect(block).toContain("plan mode");
    expect(block).toMatch(/not available/u);
  });

  test("it rides in the preamble, never the cached system prompt", () => {
    expect(systemPrompt({ rules: "" })).not.toContain("<mode>");
    expect(PREAMBLE_TAGS as readonly string[]).toContain("mode");
  });
});

describe("the status badge", () => {
  // the only place the user can see which mode is active between turns
  const line = (mode: string): string =>
    statusLine(
      {
        cwd: "repo",
        worktree: null,
        branch: "main",
        model: "gpt-5.6-luna",
        mode,
        tokens: 1000,
        percentUsed: 1,
        cached: null,
        totalTokensIn: 1000,
        totalTokensOut: 10,
        totalCachedTokens: 500,
        busy: false,
        queued: 0,
        frame: 0,
        sessionId: "abc12345",
      },
      200,
    )[1]
      .map((span) => span.text)
      .join("");

  test("a restricted mode is named, so it is never silently active", () => {
    expect(line("plan")).toContain("plan · ");
  });

  test("build spends no width on a badge", () => {
    expect(line("build")).not.toContain("build");
  });

  test("the badge sits beside the model rather than replacing it", () => {
    expect(line("plan")).toContain("gpt-5.6-luna");
  });
});

describe("the filter the agent actually applies", () => {
  const every = {
    ask_user: 1,
    bash: 1,
    read: 1,
    write: 1,
    edit: 1,
    grep: 1,
    glob: 1,
    web_fetch: 1,
    activate_skill: 1,
    run_subagent: 1,
    find_symbol: 1,
    rename_symbol: 1,
  };
  const mcp = [
    { name: "find_symbol", readOnly: true },
    { name: "rename_symbol", readOnly: false },
  ];

  test("build mode passes everything through untouched", () => {
    expect(allowedTools(every, MODES[0], mcp)).toEqual(every);
  });

  test("plan mode removes the tools that can change things", () => {
    const kept = Object.keys(allowedTools(every, modeByName("plan") as Mode, mcp));
    for (const gone of ["bash", "write", "edit", "run_subagent"]) expect(kept).not.toContain(gone);
  });

  test("plan mode keeps an MCP tool its server declared read-only", () => {
    const kept = Object.keys(allowedTools(every, modeByName("plan") as Mode, mcp));
    expect(kept).toContain("find_symbol");
    expect(kept).not.toContain("rename_symbol");
  });

  test("an undeclared MCP tool is withheld rather than guessed at", () => {
    const kept = Object.keys(allowedTools({ mystery_tool: 1 }, modeByName("plan") as Mode, []));
    expect(kept).toEqual([]);
  });
});
