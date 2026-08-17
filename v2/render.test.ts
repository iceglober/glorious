import { describe, expect, test } from "bun:test";
import {
  elapsed,
  eventBlock,
  type Line,
  reasoningBlock,
  reasoningDraft,
  rightClip,
  runningRow,
  statusLine,
  statusRow,
  toolRow,
  width,
} from "./render";

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

describe("the activity row", () => {
  const text = (columns: number, phase?: { name: string; ms: number } | null) =>
    statusRow(true, 0, columns, phase)
      .flat()
      .map((span) => span.text)
      .join("");

  test("it names the phase and how long it has been in it", () => {
    expect(text(120, { name: "waiting", ms: 2300 })).toContain("waiting 2.3s");
  });

  test("without a phase the line is what it always was", () => {
    const bare = text(120, null);
    expect(bare).toContain("Esc interrupt");
    expect(bare).not.toContain("waiting");
  });

  test("the phase leads, so a narrow terminal clips the fixed hint instead", () => {
    expect(text(30, { name: "thinking", ms: 8100 })).toContain("thinking 8.1s");
  });

  test("no row is ever wider than the terminal", () => {
    for (const columns of [12, 24, 40, 80, 200])
      for (const phase of [null, { name: "waiting", ms: 65_000 }])
        expect(text(columns, phase).length).toBeLessThanOrEqual(columns);
  });

  test("a queued count still reaches the line", () => {
    const line = statusRow(true, 2, 140, { name: "writing", ms: 400 })
      .flat()
      .map((s) => s.text)
      .join("");
    expect(line).toContain("2 queued");
    expect(line).toContain("writing 0.4s");
  });

  test("elapsed stays readable past a minute", () => {
    expect(elapsed(400)).toBe("0.4s");
    expect(elapsed(59_400)).toBe("59.4s");
    expect(elapsed(65_000)).toBe("1m 5s");
  });

  test("an idle turn still paints nothing", () => {
    expect(statusRow(false, 0, 120, { name: "waiting", ms: 100 })[0][0].text).toBe("");
  });

  // The block that used to march across every running row, and the sine field
  // that filled this line, carried no information the row did not already have
  // and cost a repaint eleven times a second. Both are gone; the elapsed
  // readings that do carry information stay.
  test("nothing animates: the same inputs paint the same row every time", () => {
    const once = text(120, { name: "waiting", ms: 2300 });
    expect(text(120, { name: "waiting", ms: 2300 })).toBe(once);
    expect(once).not.toMatch(/[▁▂▃▄▅▆▇█]/u);
  });

  test("a running tool row carries a static mark, not a moving one", () => {
    const row = runningRow("bash", "sleep 3")
      .flat()
      .map((span) => span.text)
      .join("");
    expect(row).not.toContain("█");
    expect(row).toContain("bash");
    expect(row).toContain("sleep 3");
  });
});

// The model always received the reason — it is the tool's return value — but
// the transcript showed only `✗ edit 2 files`, so a failure the agent then
// worked around looked, from the outside, like nothing had happened.
describe("a failed tool row says why", () => {
  const text = (lines: Line[]): string =>
    lines.map((line) => line.map((span) => span.text).join("")).join("\n");

  test("the reason lands under the row", () => {
    const rows = toolRow(
      "edit",
      "2 files",
      24,
      false,
      undefined,
      "ERROR: file 2/2 (b.txt) edit 1/1: old_string not found. Nothing was written.",
    );
    expect(rows).toHaveLength(2);
    expect(text(rows)).toContain("b.txt");
    expect(text(rows)).toContain("old_string not found");
  });

  test("the ERROR: prefix is dropped — the ✗ already says that", () => {
    expect(text(toolRow("read", "x", 1, false, undefined, "ERROR: nope"))).not.toContain("ERROR:");
  });

  test("a successful row is unchanged", () => {
    expect(toolRow("read", "a.txt", 1, true, undefined, "file contents")).toHaveLength(1);
  });

  test("a long result is clipped rather than pasted into the transcript", () => {
    const rows = toolRow("bash", "x", 1, false, undefined, `ERROR: ${"y".repeat(30_000)}`);
    expect(text(rows).length).toBeLessThan(400);
  });

  test("an empty result adds no row", () => {
    expect(toolRow("bash", "x", 1, false, undefined, "")).toHaveLength(1);
  });
});
