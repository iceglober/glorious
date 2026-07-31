import { describe, expect, test } from "bun:test";
import type { ToolExecutor } from "../ports/tools";
import { createHeartbeat, elideCommand, withProgress } from "./tool-progress";

const lines: string[] = [];
const write = (line: string) => {
  lines.push(line);
};

const slowTool = (ms: number, ok = true): ToolExecutor => ({
  execute: async () => {
    await Bun.sleep(ms);
    return ok
      ? { ok: true, value: "out" }
      : { ok: false, error: { reason: "tool_error", message: "boom" } };
  },
});

describe("tool progress", () => {
  test("announces the command and how it ended", async () => {
    lines.length = 0;
    let clock = 0;
    const tool = withProgress(slowTool(5), { write, now: () => clock });

    clock = 0;
    const result = await tool.execute("bash", { command: "wc -w README.md" });
    clock = 2_400;

    expect(result).toEqual({ ok: true, value: "out" });
    expect(lines[0]).toBe("$ wc -w README.md");
  });

  test("reports how long the command actually took", async () => {
    lines.length = 0;
    const times = [0, 2_400];
    const tool = withProgress(slowTool(5), { write, now: () => times.shift() ?? 2_400 });

    await tool.execute("bash", { command: "sleep 2" });

    expect(lines).toEqual(["$ sleep 2", "  ok (2.4s)"]);
  });

  test("a failure is reported as such", async () => {
    lines.length = 0;
    const tool = withProgress(slowTool(1, false), { write, now: () => 0 });

    await tool.execute("bash", { command: "false" });

    expect(lines[1]).toBe("  failed");
  });

  test("says it is still running, then stops when the command ends", async () => {
    lines.length = 0;
    let clock = 0;
    const tool = withProgress(slowTool(120), {
      write,
      everyMs: 20,
      now: () => {
        clock += 3_000;
        return clock;
      },
    });

    await tool.execute("bash", { command: "sleep 12" });
    const settled = lines.length;
    await Bun.sleep(60);

    expect(lines.some((line) => line.includes("still running"))).toBe(true);
    // Nothing keeps ticking after the command finished.
    expect(lines).toHaveLength(settled);
  });

  test("passes through anything that is not a shell command", async () => {
    lines.length = 0;
    const tool = withProgress(slowTool(1), { write });

    expect(await tool.execute("other", { nothing: true })).toEqual({ ok: true, value: "out" });
    expect(lines).toEqual([]);
  });

  test("elides a long command from the middle, keeping both ends", () => {
    const command = `find . -maxdepth 3 ${"-not -path './node_modules/*' ".repeat(5)}-print`;
    const elided = elideCommand(command);

    expect(elided.length).toBeLessThanOrEqual(100);
    expect(elided).toContain("…");
    expect(elided.startsWith("find . -maxdepth 3")).toBe(true);
    expect(elided.endsWith("-print")).toBe(true);
  });

  test("a heartbeat that is never started never writes", async () => {
    lines.length = 0;
    const beat = createHeartbeat({ everyMs: 10, write, now: () => 0 });
    beat.stop();
    await Bun.sleep(30);

    expect(lines).toEqual([]);
  });
});
