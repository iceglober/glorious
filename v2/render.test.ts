import { describe, expect, test } from "bun:test";
import {
  elapsed,
  eventBlock,
  type Line,
  queuedRow,
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
    statusRow({ busy: true, queued: 0, columns, phase })
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
    const line = statusRow({
      busy: true,
      queued: 2,
      columns: 140,
      phase: { name: "writing", ms: 400 },
    })
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
    expect(
      statusRow({ busy: false, queued: 0, columns: 120, phase: { name: "waiting", ms: 100 } })[0][0]
        .text,
    ).toBe("");
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
// The row is three parts: what happened on the header, the arguments under it,
// and the tail of the output under that. A 30k result contributes three lines.
describe("the tool row format", () => {
  const text = (lines: Line[]): string =>
    lines.map((line) => line.map((span) => span.text).join("")).join("\n");

  test("header, args, then the last lines of output", () => {
    const rows = toolRow("bash", "git status", 1240, true, undefined, "a\nb\nc\nd\ne");
    expect(text(rows).split("\n")).toEqual([
      "  ✓ bash  1.2s",
      "    git status",
      "    c",
      "    d",
      "    e",
    ]);
  });

  test("a running row has no duration — there is nothing to report yet", () => {
    const rows = runningRow("bash", "sleep 3");
    expect(text(rows)).toBe("  → bash\n    sleep 3");
  });

  test("at most three output lines, however much came back", () => {
    const rows = toolRow("bash", "x", 1, true, undefined, "l".repeat(10).split("").join("\n"));
    expect(rows).toHaveLength(5);
  });

  test("blank lines do not count toward the three", () => {
    const rows = toolRow("bash", "x", 1, true, undefined, "a\n\n\n\nb");
    expect(text(rows).split("\n").slice(2)).toEqual(["    a", "    b"]);
  });

  test("a long line is clamped rather than wrapped across the transcript", () => {
    const rows = toolRow("bash", "y".repeat(500), 1, true, undefined, "z".repeat(500));
    for (const line of text(rows).split("\n")) expect(line.length).toBeLessThan(160);
  });

  test("failure output is danger-toned, and the ERROR: prefix is dropped", () => {
    const rows = toolRow("edit", "2 files", 24, false, undefined, "ERROR: old_string not found");
    expect(text(rows)).toContain("old_string not found");
    expect(text(rows)).not.toContain("ERROR:");
    expect(rows.at(-1)?.[0].tone).toBe("danger");
  });

  test("nothing to say means a single line", () => {
    expect(toolRow("glob", "", 3, true, undefined, "")).toHaveLength(1);
  });

  test("an extension's renderer replaces the body, not the header", () => {
    const rows = toolRow("web_fetch", "x", 3000, true, [[{ text: "fetched 2 pages" }]], "ignored");
    expect(text(rows)).toBe("  ✓ web_fetch  3.0s\n    fetched 2 pages");
  });
});

describe("the queued count matches the queued rows", () => {
  const spans = (queued: number, columns = 140) =>
    statusRow({ busy: true, queued, columns, phase: { name: "writing", ms: 400 } })[0];

  test("it carries the same tone a queued row does", () => {
    const count = spans(2).find((span) => span.text.includes("queued"));
    expect(count?.tone).toBe("warning");
    expect(queuedRow("x")[0].tone).toBe("warning");
  });

  test("the phase and the hint stay accent", () => {
    expect(spans(2)[0]).toMatchObject({ tone: "accent" });
    expect(spans(2)[0].text).toContain("writing 0.4s");
    expect(spans(2)[0].text).toContain("Esc interrupt");
  });

  test("no count, no extra span", () => {
    expect(spans(0)).toHaveLength(1);
  });

  // The count is redundant with the rows above it, so it is what goes when
  // there is no room — not the live reading or the way to stop the turn.
  test("a narrow terminal drops the count before the phase", () => {
    const narrow = spans(3, 22)
      .map((span) => span.text)
      .join("");
    expect(narrow).toContain("writing");
    expect(narrow).not.toContain("queued");
    expect(narrow.length).toBeLessThanOrEqual(22);
  });

  test("no row is ever wider than the terminal", () => {
    for (const columns of [10, 18, 24, 60, 200])
      for (const queued of [0, 1, 12])
        expect(
          spans(queued, columns)
            .map((span) => span.text)
            .join("").length,
        ).toBeLessThanOrEqual(columns);
  });
});
