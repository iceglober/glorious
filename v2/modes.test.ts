import { describe, expect, test } from "bun:test";
import { allowedTools } from "./agent";
import { DEFAULT_MODE, MODES, type Mode, modeByName, nextMode } from "./modes";
import { modePrompt, PREAMBLE_TAGS, systemPrompt } from "./prompt";
import { modeLabel, statusLine } from "./render";
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

  test("cycles through modes and wraps to build", () => {
    expect(nextMode("build").name).toBe("plan");
    expect(nextMode("plan").name).toBe("build");
    expect(nextMode("unknown")).toBe(DEFAULT_MODE);
  });

  test("every mode has a description", () => {
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

describe("the mode label under the composer", () => {
  const text = (mode: Mode): string =>
    modeLabel(mode)
      .map((span) => span.text)
      .join("");

  test("every mode is named, so none is ever silently active", () => {
    for (const mode of MODES) expect(text(mode)).toContain(mode.name);
  });

  test("each mode carries its own colour, so they are told apart at a glance", () => {
    const tones = MODES.map((mode) => mode.tone);
    expect(new Set(tones).size).toBe(MODES.length);
  });

  test("the label is coloured with the mode's own tone, not a fixed one", () => {
    for (const mode of MODES) for (const span of modeLabel(mode)) expect(span.tone).toBe(mode.tone);
  });

  test("it no longer rides in the status line", () => {
    const lines = statusLine({ model: "gpt-5.6-luna", tokens: 1000, percentUsed: 1 }, 200);
    expect(lines).toHaveLength(1);
    const line = lines
      .flat()
      .map((span) => span.text)
      .join("");
    expect(line).toBe("gpt-5.6-luna · ctx 1.0k(1%)");
    for (const detail of ["repo", "main", "abc12345", "in", "out", "$0.00", "cached"])
      expect(line).not.toContain(detail);
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
