import { describe, expect, test } from "bun:test";
import { atFirstLine, atLastLine, composerKeyBindings, composerWrapMode } from "./composer";

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

describe("when an arrow reaches for history", () => {
  const draft = "first line\nsecond line\nthird line";

  test("a single-line draft is both first and last, so arrows still cycle history", () => {
    expect(atFirstLine("hello", 3)).toBe(true);
    expect(atLastLine("hello", 3)).toBe(true);
  });

  test("an empty composer cycles history, which is the common case", () => {
    expect(atFirstLine("", 0)).toBe(true);
    expect(atLastLine("", 0)).toBe(true);
  });

  test("the top line reaches back, the ones below it do not", () => {
    expect(atFirstLine(draft, 4)).toBe(true);
    expect(atFirstLine(draft, 15)).toBe(false);
    expect(atFirstLine(draft, draft.length)).toBe(false);
  });

  test("the bottom line reaches forward, the ones above it do not", () => {
    expect(atLastLine(draft, draft.length - 2)).toBe(true);
    expect(atLastLine(draft, 15)).toBe(false);
    expect(atLastLine(draft, 0)).toBe(false);
  });

  test("the boundary sits on the newline, not one character off", () => {
    const two = "ab\ncd";
    // cursor just before the newline is still the first line
    expect(atFirstLine(two, 2)).toBe(true);
    // cursor just after it is not
    expect(atFirstLine(two, 3)).toBe(false);
  });

  test("a trailing newline means the cursor after it is the last line", () => {
    expect(atLastLine("ab\n", 3)).toBe(true);
    expect(atLastLine("ab\n", 0)).toBe(false);
  });

  test("an out-of-range cursor does not throw", () => {
    expect(atFirstLine(draft, -5)).toBe(true);
    expect(atLastLine(draft, 9999)).toBe(true);
  });
});
