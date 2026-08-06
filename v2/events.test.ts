import { describe, expect, test } from "bun:test";
import type { ModelMessage } from "ai";
import { eventsFromMessages, messagesOf, type SessionEvent, typedText } from "./events";
import { transcript } from "./render";

const text = (lines: ReturnType<typeof transcript>): string =>
  lines.map((line) => line.map((span) => span.text).join("")).join("\n");

describe("messagesOf", () => {
  test("folds turn deltas in order and ignores display events", () => {
    const events: SessionEvent[] = [
      { type: "user", text: "one" },
      { type: "turn", messages: [{ role: "user", content: "one" }] },
      { type: "assistant", text: "first" },
      { type: "usage", tokens: 10, cached: 0 },
      { type: "turn", messages: [{ role: "assistant", content: "first" }] },
    ];
    expect(messagesOf(events)).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
    ]);
  });

  test("a log with no committed turn yields no messages", () => {
    expect(
      messagesOf([
        { type: "user", text: "hi" },
        { type: "error", text: "boom" },
      ]),
    ).toEqual([]);
  });
});

describe("migration from schema 1", () => {
  const messages: ModelMessage[] = [
    { role: "user", content: "add a test" },
    { role: "assistant", content: "done" },
  ];

  test("round-trips the exact message array the model needs", () => {
    expect(messagesOf(eventsFromMessages(messages))).toEqual(messages);
  });

  test("replays the transcript that was shown", () => {
    expect(text(transcript(eventsFromMessages(messages)))).toContain("add a test");
    expect(text(transcript(eventsFromMessages(messages)))).toContain("done");
  });

  test("empty history migrates to an empty log", () => {
    expect(eventsFromMessages([])).toEqual([]);
  });
});

describe("typedText", () => {
  test("strips the environment block the agent prepends to each prompt", () => {
    const sent: ModelMessage = {
      role: "user",
      content:
        "<where-you-are>\nDarwin 25.2.0 · 2026-08-06\ndir /repo\ngit main clean\n</where-you-are>\n\nfix the bug",
    };
    expect(typedText(sent)).toBe("fix the bug");
  });

  test("strips the skills catalog the agent prepends alongside it", () => {
    const sent: ModelMessage = {
      role: "user",
      content:
        "<where-you-are>\nDarwin\ndir /repo\ngit main clean\n</where-you-are>\n\n<skills>\n  guidance\n<available_skills>\n  <skill><name>verify</name></skill>\n</available_skills>\n</skills>\n\nfix the bug",
    };
    expect(typedText(sent)).toBe("fix the bug");
  });

  test("leaves a plain prompt untouched", () => {
    expect(typedText({ role: "user", content: "fix the bug" })).toBe("fix the bug");
  });
});

describe("transcript", () => {
  test("orders an assistant preamble above the tools it announces", () => {
    const events: SessionEvent[] = [
      { type: "user", text: "read the file" },
      { type: "assistant", text: "I'll read it." },
      { type: "tool", name: "read", detail: "hello.txt", elapsedMs: 1, ok: true },
      { type: "assistant", text: "the quick brown fox" },
    ];
    const rows = text(transcript(events))
      .split("\n")
      .filter((row) => row.trim() !== "");
    const at = (needle: string) => rows.findIndex((row) => row.includes(needle));
    expect(at("I'll read it.")).toBeLessThan(at("hello.txt"));
    expect(at("hello.txt")).toBeLessThan(at("the quick brown fox"));
  });

  test("renders a failed tool with the failure mark and elapsed time", () => {
    const rendered = text(
      transcript([{ type: "tool", name: "bash", detail: "exit 1", elapsedMs: 3000, ok: false }]),
    );
    expect(rendered).toContain("✗");
    expect(rendered).toContain("3.0s");
  });

  test("usage and turn events paint nothing", () => {
    expect(
      transcript([
        { type: "usage", tokens: 100, cached: 90 },
        { type: "turn", messages: [{ role: "user", content: "x" }] },
      ]),
    ).toEqual([]);
  });
});
