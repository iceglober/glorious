import { describe, expect, test } from "bun:test";
import { clip } from "./coding-agent";

describe("clip", () => {
  test("leaves anything within the limit untouched", () => {
    expect(clip("short", 100)).toBe("short");
    expect(clip("x".repeat(100), 100)).toBe("x".repeat(100));
  });

  test("keeps the end, which is where a build or test says what went wrong", () => {
    const output = `${"preamble ".repeat(200)}FAILED: 3 tests did not pass`;
    const clipped = clip(output, 200);

    expect(clipped).toContain("FAILED: 3 tests did not pass");
    expect(clipped.startsWith("preamble")).toBe(true);
    expect(clipped.length).toBeLessThanOrEqual(200);
  });

  test("the number of dropped characters is the true one", () => {
    const output = "y".repeat(5_000);
    const clipped = clip(output, 300);

    const dropped = Number(/\[… (\d+) characters dropped …\]/.exec(clipped)?.[1]);
    const kept = clipped.replace(/\n\[… \d+ characters dropped …\]\n/, "").length;
    expect(dropped).toBe(output.length - kept);
  });

  test("a limit smaller than the marker still returns something bounded", () => {
    const clipped = clip("z".repeat(1_000), 10);

    expect(clipped).toContain("characters dropped");
    // Nothing of the original survives, which is honest rather than misleading.
    expect(clipped.replace(/\n\[… \d+ characters dropped …\]\n/, "")).toBe("");
  });
});
