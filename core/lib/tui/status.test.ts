import { describe, expect, test } from "bun:test";
import { composeStatusSection, formatClock, formatVuMeter } from "./status";
import { displayWidth } from "./terminal-editor";

const base = {
  root: "~/repos/glorious",
  model: "azure/gpt-5.6-sol",
  usage: { ctx: 8_700 },
};

describe("composeStatusSection", () => {
  test("is one info line: location, model, context", () => {
    expect(composeStatusSection(base, 120)).toEqual([
      "~/repos/glorious · azure/gpt-5.6-sol · ctx 8.7k",
    ]);
  });

  test("shortens location before dropping it", () => {
    const lines = composeStatusSection(
      { ...base, root: "~/.glrs/worktrees/glorious/wt-260718-231658-7yr" },
      60,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("~/.glrs/w");
    expect(lines[0]).toContain("…");
    expect(lines[0]).toContain("azure/gpt-5.6-sol · ctx 8.7k");
    expect(displayWidth(lines[0] ?? "")).toBeLessThanOrEqual(60);
  });

  test("degrades the info line to model, then bare context", () => {
    expect(composeStatusSection(base, 38)[0]).toBe("azure/gpt-5.6-sol · ctx 8.7k");
    expect(composeStatusSection(base, 20)[0]).toBe("ctx 8.7k");
  });

  test("shows context against the configured soft limit without a warning glyph", () => {
    expect(composeStatusSection({ ...base, contextSoftLimit: 10_000 }, 120)[0]).toContain(
      "ctx 8.7k/10.0k",
    );
    // Over the limit is still plain text — no glyph, no tone.
    expect(composeStatusSection({ ...base, contextSoftLimit: 8_000 }, 120)[0]).toContain(
      "ctx 8.7k/8.0k",
    );
  });

  test("scales the context count by magnitude", () => {
    expect(composeStatusSection({ ...base, usage: { ctx: 456 } }, 120)[0]).toContain("ctx 456");
    expect(composeStatusSection({ ...base, usage: { ctx: 1_952_300 } }, 120)[0]).toContain(
      "ctx 2.0m",
    );
  });

  test("fits Unicode roots at every width without screen clipping", () => {
    for (const width of [0, 1, 8, 20, 35, 50, 80]) {
      const lines = composeStatusSection({ ...base, root: "~/界/very/deep/project/🙂" }, width);
      expect(lines).toHaveLength(1);
      expect(displayWidth(lines[0] ?? "")).toBeLessThanOrEqual(width);
    }
    // A width that leaves room for a shortened root keeps its head and its leaf.
    const line = composeStatusSection({ ...base, root: "~/界/very/deep/project/🙂" }, 50)[0] ?? "";
    expect(line).toContain("~/界");
    expect(line).toContain("🙂");
    expect(line).toContain("…");
  });
});

describe("formatVuMeter", () => {
  const BLOCKS = new Set([..."▁▂▃▄▅▆▇█"]);

  test("renders one bobbing block per bar, deterministic in the frame", () => {
    expect([...formatVuMeter(0)]).toHaveLength(5);
    expect([...formatVuMeter(0, 3)]).toHaveLength(3);
    expect([...formatVuMeter(7)].every((glyph) => BLOCKS.has(glyph))).toBe(true);
    expect(formatVuMeter(4)).toBe(formatVuMeter(4)); // same frame → same bars
  });

  test("animates: the bars change as the frame advances", () => {
    const frames = new Set([0, 1, 2, 3, 4, 5].map((frame) => formatVuMeter(frame)));
    expect(frames.size).toBeGreaterThan(1);
  });
});

describe("formatClock", () => {
  test("scales units with elapsed time", () => {
    expect(formatClock(9_000)).toBe("9s");
    expect(formatClock(74_000)).toBe("1m14s");
    expect(formatClock(3.5 * 3_600_000)).toBe("3h30m");
    expect(formatClock(30 * 3_600_000)).toBe("1d6h0m");
  });
});
