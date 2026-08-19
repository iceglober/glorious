import { describe, expect, test } from "bun:test";
import {
  atFirstLine,
  atLastLine,
  completionWindow,
  composerKeyBindings,
  composerWrapMode,
  isAlt,
} from "./composer";

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

// Reported from a live session: `@` offered a handful of files and there was no
// way to reach the rest. The search cap was one half of that; a list that
// painted every match and grew to fit was the other.
describe("the completion window", () => {
  test("a short list is shown whole, with nothing off either end", () => {
    expect(completionWindow(3, 0, 10)).toEqual({ first: 0, count: 3, above: 0, below: 0 });
  });

  test("a long list starts at the top and says how much is below", () => {
    expect(completionWindow(60, 0, 10)).toEqual({ first: 0, count: 10, above: 0, below: 50 });
  });

  test("the window follows the selection down the list", () => {
    expect(completionWindow(60, 12, 10)).toEqual({ first: 3, count: 10, above: 3, below: 47 });
  });

  test("the last page is a full page, not a window hanging off the end", () => {
    expect(completionWindow(60, 59, 10)).toEqual({ first: 50, count: 10, above: 50, below: 0 });
  });

  test("the selection is always inside the window, wherever it is", () => {
    for (let index = 0; index < 60; index += 1) {
      const { first, count } = completionWindow(60, index, 10);
      expect(index).toBeGreaterThanOrEqual(first);
      expect(index).toBeLessThan(first + count);
    }
  });

  test("an empty list asks for no rows", () => {
    expect(completionWindow(0, 0, 10)).toEqual({ first: 0, count: 0, above: 0, below: 0 });
  });
});

// The window was a flat ten rows and never asked how tall the terminal was, so
// on a short one the last rows were clipped and moving the selection into them
// looked like a list that refused to scroll.
describe("the completion window on a short terminal", () => {
  test("it shows only what fits, and still follows the selection", () => {
    const { first, count } = completionWindow(50, 20, 3);
    expect(count).toBe(3);
    expect(20).toBeGreaterThanOrEqual(first);
    expect(20).toBeLessThan(first + count);
  });

  test("one row is still a working window", () => {
    for (let index = 0; index < 10; index += 1) {
      const { first, count } = completionWindow(10, index, 1);
      expect(count).toBe(1);
      expect(first).toBe(index);
    }
  });
});

// Alt is the modifier that turns Enter into a steering message and Up into
// "give me that back". Reading only the kitty-protocol flag would make both
// chords silently do nothing in every terminal that does not speak it.
describe("spotting the Alt modifier", () => {
  test("the ESC-prefix path reports it as meta", () => {
    expect(isAlt({ meta: true, option: false })).toBe(true);
  });

  test("the kitty path reports it as option", () => {
    expect(isAlt({ meta: false, option: true })).toBe(true);
  });

  test("an unmodified key is not Alt", () => {
    expect(isAlt({ meta: false, option: false })).toBe(false);
    expect(isAlt({})).toBe(false);
  });
});
