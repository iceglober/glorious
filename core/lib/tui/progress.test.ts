import { describe, expect, test } from "bun:test";
import {
  type ActiveToolActivity,
  composeProgressLines,
  countVisibleToolActivities,
  formatDuration,
  formatToolActivityLabel,
  formatToolSweep,
  isToolActivityVisible,
  TOOL_ACTIVITY_VISIBILITY_DELAY_MS,
} from "./progress";

/** The computed running-tool row prefix at frame 0 (a sweep, not a spinner). */
const t = (label: string): string => `  ${formatToolSweep(0)} ${label}`;

describe("formatToolSweep", () => {
  test("is a fixed 5-wide bar that never fully empties (never blinks)", () => {
    for (let f = 0; f < 40; f += 1) {
      const s = formatToolSweep(f);
      expect(s.length).toBe(5);
      expect(s).toContain("█"); // always at least one filled cell
    }
  });

  test("sweeps side to side: grows from the left, then slides right", () => {
    expect(formatToolSweep(0)).toBe("█    ");
    expect(formatToolSweep(4)).toBe("█████");
    expect(formatToolSweep(8)).toBe("    █"); // fill has slid fully to the right
  });

  test("wraps cleanly and tolerates negative frames", () => {
    expect(formatToolSweep(16)).toBe(formatToolSweep(0));
    expect(formatToolSweep(-16)).toBe(formatToolSweep(0));
  });
});

describe("tool activity", () => {
  const tools = (entries: Array<[number, string, string?]>): Array<[number, ActiveToolActivity]> =>
    entries.map(([id, tool, detail]) => [id, { tool, detail: detail ?? "" }]);

  test("keeps rapid tools out of the live region until they have lasted 250ms", () => {
    const now = 1_000;
    const activeTools: Array<[number, ActiveToolActivity]> = [
      [
        1,
        { tool: "bash", detail: "quick", startedAt: now - (TOOL_ACTIVITY_VISIBILITY_DELAY_MS - 1) },
      ],
      [2, { tool: "readFile", detail: "slow", startedAt: now - TOOL_ACTIVITY_VISIBILITY_DELAY_MS }],
    ];
    expect(composeProgressLines({ activeTools, queued: [], frame: 0, now })).toEqual([
      t("readFile slow"),
    ]);
    expect(countVisibleToolActivities(activeTools, now)).toBe(1);
  });

  test("an activity with no start time is visible immediately", () => {
    expect(isToolActivityVisible({ tool: "bash", detail: "" }, 0)).toBe(true);
    expect(countVisibleToolActivities([{ tool: "bash", detail: "" }], 0)).toBe(1);
  });

  test("keeps each tool's basic arguments on live rows, in start order", () => {
    const lines = composeProgressLines({
      activeTools: tools([
        [1, "bash", "git status --short"],
        [2, "readFile", "a.ts"],
      ]),
      queued: [],
      frame: 0,
    });
    expect(lines).toEqual([t("bash git status --short"), t("readFile a.ts")]);
  });

  test("queued lines trail the live tool rows", () => {
    expect(
      composeProgressLines({
        activeTools: tools([[1, "bash", "ls"]]),
        queued: ["  ↳ queued: run the tests"],
        frame: 0,
      }),
    ).toEqual([t("bash ls"), "  ↳ queued: run the tests"]);
    // Queued prompts render on their own when nothing is running.
    expect(
      composeProgressLines({
        activeTools: [],
        queued: ["  ↳ queued: run the tests"],
        frame: 0,
      }),
    ).toEqual(["  ↳ queued: run the tests"]);
    // Nothing running and nothing queued hides the region entirely.
    expect(composeProgressLines({ activeTools: [], queued: [], frame: 0 })).toEqual([]);
  });

  test("formats completed labels as safe one-line previews", () => {
    expect(formatToolActivityLabel("bash", "git status\n--short")).toBe("bash git status --short");
    const preview = formatToolActivityLabel("bash", "x".repeat(200), 20);
    expect(preview).toStartWith("bash ");
    expect(preview).toContain("[trunc");
    expect(preview).not.toContain("\n");
  });

  test("a detail-less tool renders as the bare tool name", () => {
    expect(formatToolActivityLabel("bash", "")).toBe("bash");
  });
});

test("formatDuration uses ms under a second", () => {
  expect(formatDuration(0)).toBe("0ms");
  expect(formatDuration(340)).toBe("340ms");
  expect(formatDuration(999)).toBe("999ms");
  expect(formatDuration(2140)).toBe("2.1s");
  expect(formatDuration(74_200)).toBe("74.2s");
});
