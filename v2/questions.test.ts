import { describe, expect, test } from "bun:test";
import { createQuestions } from "./ui/questions";

const node = () => ({
  height: 0,
  content: "",
  destroy() {},
  focus() {},
  blur() {},
  setText() {},
  plainText: "",
  on() {},
  options: [] as unknown[],
  getSelectedOption: () => undefined,
});

// classes, not arrow functions: questions.ts calls these with `new`, and the
// formatter rewrites a function expression into an arrow, which cannot be.
class Stub {
  height = 0;
  content = "";
  plainText = "";
  options: unknown[] = [];
  destroy() {}
  focus() {}
  blur() {}
  setText() {}
  on() {}
  getSelectedOption() {
    return undefined;
  }
}

const chrome = {
  tui: {
    SelectRenderable: Stub,
    TextareaRenderable: Stub,
    defaultTextareaKeyBindings: [],
  },
  renderer: { root: { add() {}, remove() {} } },
  columns: () => 100,
  textNode: () => node(),
  stack: () => node(),
  styled: () => "",
} as never;

const host = { draw() {}, focusComposer() {}, blurComposer() {} };

describe("ask() re-entrancy", () => {
  test("a second concurrent question is refused, and the first still resolves", async () => {
    const q = createQuestions(chrome, host);
    const first = q.ask([{ question: "one?", options: ["a"] }], undefined);
    const second = await q.ask([{ question: "two?", options: ["b"] }], undefined);
    expect(second).toContain("already open");
    expect(q.isOpen()).toBe(true);
    // the first is still live, not stranded
    expect(await Promise.race([first, Promise.resolve("PENDING")])).toBe("PENDING");
  });
});
