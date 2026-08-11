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
  add() {},
  remove() {},
  backgroundColor: "",
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
  renderer: {
    root: {
      add(child: unknown) {
        rootAdds.push(child);
      },
      remove() {},
    },
  },
  columns: () => 100,
  textNode: () => node(),
  stack: () => node(),
  styled: () => "",
} as never;

let slot: unknown = null;
const rootAdds: unknown[] = [];
const host = {
  draw() {},
  focusComposer() {},
  blurComposer() {},
  useComposerSlot(node: unknown) {
    slot = node;
  },
};

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

describe("where a question renders", () => {
  test("it takes the composer's slot, never floats over the transcript", () => {
    slot = null;
    rootAdds.length = 0;
    const q = createQuestions(chrome, host);
    void q.ask([{ question: "one?", options: ["a"] }], undefined);
    expect(slot).not.toBeNull();
    // a modal would have been added to the root instead
    expect(rootAdds).toHaveLength(0);
  });

  test("answering hands the slot back, so the composer returns", () => {
    slot = null;
    const q = createQuestions(chrome, host);
    void q.ask([{ question: "one?", options: ["a"] }], undefined);
    const controller = new AbortController();
    void q.ask([{ question: "two?", options: ["b"] }], controller.signal);
    q.handleKey({ name: "escape", stopPropagation() {} } as never);
    expect(slot).toBeNull();
    expect(q.isOpen()).toBe(false);
  });
});
