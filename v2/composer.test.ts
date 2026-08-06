import { describe, expect, test } from "bun:test";
import { composerKeyBindings, composerWrapMode } from "./composer";

describe("prompt composer", () => {
  test("wraps at word boundaries", () => {
    expect(composerWrapMode).toBe("word");
  });

  test("removes plain Enter bindings while retaining modified Enter bindings", () => {
    const bindings = composerKeyBindings([
      { name: "return" },
      { name: "kpenter" },
      { name: "linefeed" },
      { name: "up" },
      { name: "down" },
      { name: "return", shift: true },
      { name: "left" },
    ]);

    expect(bindings).toEqual([{ name: "return", shift: true }, { name: "left" }]);
  });
});
