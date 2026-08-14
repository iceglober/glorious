import { describe, expect, test } from "bun:test";
import { eventBlock, reasoningBlock, reasoningDraft, rightClip, statusLine, width } from "./render";

const state = (model: string, tokens = 1000, percentUsed: number | null = 1) => ({
  model,
  tokens,
  percentUsed,
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
  test("renders one compact row with model and context", () => {
    const lines = statusLine(state("model"), 200);
    expect(lines).toHaveLength(1);
    const line = lines[0].map((span) => span.text).join("");
    expect(line).toBe("model · ctx 1.0k(1%)");
    expect(line).not.toContain("cached");
    expect(line).not.toContain("session");
  });

  test("clips the compact row to the available width", () => {
    const columns = 20;
    const line = statusLine(state("very-long-model"), columns)[0]
      .map((span) => span.text)
      .join("");
    expect(line).toBe("very-long-model · c…");
    expect(width(line)).toBeLessThanOrEqual(columns);
  });
});

describe("reasoning in the transcript", () => {
  const text = (lines: ReturnType<typeof reasoningBlock>) =>
    lines.map((line) => line.map((span) => span.text).join("")).join("\n");

  test("it collapses to a duration, never the reasoning itself", () => {
    expect(text(reasoningBlock(14_000))).toBe("░ thought for 14s");
  });

  test("a sub-second think still reports a second rather than zero", () => {
    expect(text(reasoningBlock(120))).toContain("1s");
  });

  test("the event renders collapsed, so a long think cannot bury the answer", () => {
    const block = eventBlock({
      type: "reasoning",
      text: "a".repeat(5000),
      elapsedMs: 3000,
    });
    expect(text(block.lines)).toBe("░ thought for 3s");
    expect(text(block.lines)).not.toContain("aaa");
  });

  test("while streaming it shows the tail, so the newest thinking is visible", () => {
    const draft = reasoningDraft("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight");
    expect(draft).toHaveLength(6);
    expect(text(draft)).toContain("eight");
    expect(text(draft)).not.toContain("one");
  });

  test("blank lines are dropped rather than painting empty rows", () => {
    expect(reasoningDraft("a\n\n\nb")).toHaveLength(2);
  });
});
