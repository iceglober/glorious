import { describe, expect, test } from "bun:test";
import {
  eventsFromMessages,
  messagesOf,
  type SessionEvent,
  typedText,
  usageTotals,
} from "@glrs-dev/glorious-core/events";
import type { ModelMessage } from "ai";
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

// A cost tracker resumed mid-session should report what the session has spent,
// not what it has spent since reopening — so totals come from the events, which
// survive on disk.
describe("usage totals", () => {
  const usage = (over: Partial<Extract<SessionEvent, { type: "usage" }>> = {}): SessionEvent => ({
    type: "usage",
    tokens: 100,
    cached: 10,
    input: 100,
    output: 20,
    cost: 0.5,
    ...over,
  });

  test("sums every model call in the session", () => {
    expect(usageTotals([usage(), usage(), usage()])).toEqual({
      input: 300,
      output: 60,
      cached: 30,
      cost: 1.5,
      steps: 3,
    });
  });

  // Clearing drops what the model replays, not what the run cost.
  test("a clear does not reset the bill", () => {
    const events: SessionEvent[] = [usage(), { type: "cleared", reason: "user" }, usage()];
    expect(usageTotals(events).steps).toBe(2);
    expect(usageTotals(events).cost).toBe(1);
  });

  test("missing optional figures count as zero rather than NaN", () => {
    const totals = usageTotals([{ type: "usage", tokens: 5, cached: 0 }]);
    expect(totals).toEqual({ input: 0, output: 0, cached: 0, cost: 0, steps: 1 });
  });

  test("a session with no model call yet totals zero", () => {
    expect(usageTotals([{ type: "user", text: "hi" }]).steps).toBe(0);
  });
});

// A resumed session has to inherit the compaction, not re-inflate to the full
// history and blow the same limit on its first turn.
describe("replaying a compacted session", () => {
  const turn = (text: string): SessionEvent => ({
    type: "turn",
    messages: [{ role: "user", content: text }],
  });

  test("the fold restarts at the compaction and leads with the summary", () => {
    const replayed = messagesOf([
      turn("ancient"),
      turn("old"),
      { type: "compacted", summary: "THE BRIEF", dropped: 2 },
      turn("recent"),
    ]);
    expect(JSON.stringify(replayed[0])).toContain("THE BRIEF");
    expect(JSON.stringify(replayed)).not.toContain("ancient");
    expect(JSON.stringify(replayed)).toContain("recent");
  });

  test("a later clear still wins, and drops the summary too", () => {
    const replayed = messagesOf([
      { type: "compacted", summary: "THE BRIEF", dropped: 2 },
      turn("after compaction"),
      { type: "cleared", reason: "user" },
      turn("after clear"),
    ]);
    expect(JSON.stringify(replayed)).not.toContain("THE BRIEF");
    expect(JSON.stringify(replayed)).toContain("after clear");
  });

  test("the transcript is untouched — compaction changes what the model replays", () => {
    const events: SessionEvent[] = [
      { type: "user", text: "ancient" },
      { type: "compacted", summary: "THE BRIEF", dropped: 2 },
      { type: "user", text: "recent" },
    ];
    expect(events.filter((event) => event.type === "user")).toHaveLength(2);
  });
});
