import { describe, expect, test } from "bun:test";
import askUser from "../../extensions/ask-user/src";
import {
  type Capture,
  createApi,
  createRegistry,
  type ExtensionHost,
  type Key,
} from "../../glrs-core/src/extension-api";

// The question widget is an extension, and this drives it exactly as the
// terminal does: hand it keys, read the lines it draws. If this file needed
// anything the core does not already give an extension, the tool would not be
// an extension — it would be a built-in wearing a costume.
const open = (questions: Array<{ question: string; options: string[] }>) => {
  let held: Capture | null = null;
  let closed = false;
  const registry = createRegistry();
  const host = {
    root: "/tmp",
    mode: "tui" as const,
    capture: (spec: Capture) => {
      held = spec;
      return {
        close: () => {
          closed = true;
        },
        repaint: () => {},
      };
    },
    setInput: () => {},
    print: () => {},
    columns: () => 80,
  } as unknown as ExtensionHost;

  askUser(createApi(host, registry, () => {}, "ask-user") as never);
  const tool = registry.tools.ask_user as {
    execute: (input: unknown, call: unknown) => Promise<string>;
  };
  const answer = tool.execute({ questions }, { abortSignal: undefined });
  const press = (key: string, text = ""): void =>
    held?.onKey({ key, ctrl: false, shift: false, text } as Key);
  const screen = (columns = 80): string =>
    (held?.render(columns) ?? []).map((line) => line.map((span) => span.text).join("")).join("\n");
  const type = (text: string): void => {
    for (const char of text) press(char, char);
  };
  return { answer, press, type, screen, wasClosed: () => closed };
};

const settle = (): Promise<void> => Bun.sleep(5);

describe("the question widget, driven by keys", () => {
  test("it draws the question and its options", async () => {
    const asked = open([{ question: "Which database?", options: ["Postgres", "SQLite"] }]);
    await settle();
    expect(asked.screen()).toContain("Which database?");
    expect(asked.screen()).toContain("Postgres");
    expect(asked.screen()).toContain("SQLite");
    asked.press("return");
    await asked.answer;
  });

  test("a long question wraps instead of disappearing past the viewport", async () => {
    const question = "Should this deliberately long question remain readable in a narrow viewport?";
    const asked = open([{ question, options: ["Yes", "No"] }]);
    await settle();
    const lines = asked.screen(32).split("\n");
    const heading = lines.slice(
      0,
      lines.findIndex((line) => line.includes("Yes")),
    );
    expect(heading.join(" ").replaceAll(/\s+/gu, " ")).toContain(question);
    expect(heading.length).toBeGreaterThan(1);
    expect(heading.every((line) => line.length <= 32)).toBe(true);
    asked.press("return");
    await asked.answer;
  });

  test("the cursor moves, and wraps", async () => {
    const asked = open([{ question: "Pick", options: ["one", "two"] }]);
    await settle();
    expect(asked.screen()).toContain("› one");
    asked.press("down");
    expect(asked.screen()).toContain("› two");
    asked.press("down");
    expect(asked.screen()).toContain("› one");
    asked.press("up");
    expect(asked.screen()).toContain("› two");
    asked.press("return");
    expect(await asked.answer).toContain("A: two");
  });

  test("a note is typed alongside the choice", async () => {
    const asked = open([{ question: "Which database?", options: ["Postgres", "SQLite"] }]);
    await settle();
    asked.press("down");
    asked.press("tab");
    asked.type("local only");
    expect(asked.screen()).toContain("note: local only");
    asked.press("return");
    expect(await asked.answer).toBe("Q: Which database?\nA: SQLite (local only)");
  });

  test("backspace edits the note", async () => {
    const asked = open([{ question: "Name?", options: ["ok"] }]);
    await settle();
    asked.press("tab");
    asked.type("abc");
    asked.press("backspace");
    expect(asked.screen()).toContain("note: ab");
    asked.press("return");
    expect(await asked.answer).toContain("(ab)");
  });

  // An arrow key arrives as an escape sequence; appending it would put raw
  // control characters into the note.
  test("a control key is not typed into the note", async () => {
    const asked = open([{ question: "Name?", options: ["ok"] }]);
    await settle();
    asked.press("tab");
    asked.type("ab");
    asked.press("up", `${String.fromCharCode(27)}[A`);
    asked.press("return");
    expect(await asked.answer).toContain("(ab)");
    expect(await asked.answer).not.toContain("[A");
  });

  test("questions are asked one after another", async () => {
    const asked = open([
      { question: "First?", options: ["a", "b"] },
      { question: "Second?", options: ["c", "d"] },
    ]);
    await settle();
    expect(asked.screen()).toContain("(1/2)");
    asked.press("return");
    expect(asked.screen()).toContain("Second?");
    expect(asked.screen()).toContain("(2/2)");
    asked.press("down");
    asked.press("return");
    expect(await asked.answer).toBe("Q: First?\nA: a\n\nQ: Second?\nA: d");
  });

  test("a single question carries no counter", async () => {
    const asked = open([{ question: "Only?", options: ["a"] }]);
    await settle();
    expect(asked.screen()).not.toContain("(1/1)");
    asked.press("return");
    await asked.answer;
  });

  // Silence here reads to the model as a tool that hung.
  test("escape tells the model it was dismissed, rather than hanging", async () => {
    const asked = open([{ question: "Which?", options: ["a"] }]);
    await settle();
    asked.press("escape");
    expect(await asked.answer).toContain("dismissed the questions");
  });

  test("escape while typing returns to the options rather than cancelling", async () => {
    const asked = open([{ question: "Which?", options: ["a"] }]);
    await settle();
    asked.press("tab");
    asked.type("oops");
    asked.press("escape");
    expect(asked.screen()).toContain("↑↓ move");
    asked.press("return");
    expect(await asked.answer).not.toContain("dismissed");
  });

  test("the composer is handed back when the last answer lands", async () => {
    const asked = open([{ question: "Which?", options: ["a"] }]);
    await settle();
    asked.press("return");
    await asked.answer;
    expect(asked.wasClosed()).toBe(true);
  });
});

describe("what the core is left holding", () => {
  test("it registers nothing where there is nobody to answer", () => {
    const registry = createRegistry();
    const host = { root: "/tmp", mode: "print" as const } as unknown as ExtensionHost;
    askUser(createApi(host, registry, () => {}, "ask-user") as never);
    expect(registry.tools.ask_user).toBeUndefined();
  });
});
