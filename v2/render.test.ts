import { describe, expect, test } from "bun:test";
import { rightClip, statusLine, width } from "./render";

const state = (cwd: string) => ({
  cwd,
  worktree: "src",
  branch: "main",
  model: "model",
  mode: "build",
  tokens: 1000,
  percentUsed: 1,
  cached: null,
  totalTokensIn: 1000,
  totalTokensOut: 10,
  totalCachedTokens: 0,
  busy: false,
  queued: 0,
  frame: 0,
  sessionId: "session",
});

describe("right truncation", () => {
  test("preserves short text", () => {
    expect(rightClip("short/path", 20)).toBe("short/path");
  });

  test("preserves the end of long text", () => {
    expect(rightClip("/very/long/project/path", 12)).toBe("…roject/path");
  });
});

describe("status line", () => {
  test("keeps a short cwd unchanged", () => {
    const first = statusLine(state("repo"), 200)[0]
      .map((span) => span.text)
      .join("");
    expect(first).toContain("repo:src (main)");
  });

  test("budgets a long cwd before the fixed status text", () => {
    const columns = 60;
    const first = statusLine(state("/home/user/very/long/project/path"), columns)[0]
      .map((span) => span.text)
      .join("");
    const suffix = ":src (main) · in 1.0k · out 10";
    expect(first.startsWith("…")).toBe(true);
    expect(first.endsWith(suffix)).toBe(true);
    expect(first).toContain("/project/path");
    expect(width(first)).toBeLessThanOrEqual(columns);
  });
});
