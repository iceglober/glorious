import { describe, expect, test } from "bun:test";
import {
  advanceToolRun,
  assistantBlock,
  dequeueShortcut,
  elapsed,
  errorText,
  eventBlock,
  type Line,
  NO_TOOL_RUN,
  queuedRow,
  reasoningBlock,
  reasoningDraft,
  reasoningText,
  reasoningVisible,
  rightClip,
  runningRow,
  statusLine,
  statusRow,
  toolGroupFooter,
  toolRow,
  transcript,
  width,
} from "./render";

const state = (model: string, tokens = 1000, percentUsed: number | null = 1) => ({
  model,
  tokens,
  percentUsed,
});

describe("right truncation", () => {
  test("preserves short text", () => {
    expect(rightClip("short/path", 20)).toBe("short/path");
  });

  test("preserves the end of long text", () => {
    expect(rightClip("/very/long/project/path", 12)).toBe("…roject/path");
  });
});

describe("status line", () => {
  test("renders one compact row with model and context", () => {
    const lines = statusLine(state("model"), 200);
    expect(lines).toHaveLength(1);
    const line = lines[0].map((span) => span.text).join("");
    expect(line).toBe("model · ctx 1.0k(1%)");
    expect(line).not.toContain("cached");
    expect(line).not.toContain("session");
  });

  test("clips the compact row to the available width", () => {
    const columns = 20;
    const line = statusLine(state("very-long-model"), columns)[0]
      .map((span) => span.text)
      .join("");
    expect(line).toBe("very-long-model · c…");
    expect(width(line)).toBeLessThanOrEqual(columns);
  });
});

describe("reasoning in the transcript", () => {
  const text = (lines: ReturnType<typeof reasoningBlock>) =>
    lines.map((line) => line.map((span) => span.text).join("")).join("\n");

  test("completed reasoning remains visible with its duration", () => {
    expect(text(reasoningBlock("considering\nchecking", 14_000))).toBe(
      "◐ considering\n  checking\n  thought for 14s",
    );
  });

  test("a sub-second think still reports a second rather than zero", () => {
    expect(text(reasoningBlock("quick", 120))).toContain("1s");
  });

  test("the plain representation used by print mode keeps every line", () => {
    expect(reasoningText("considering\nchecking", 14_000)).toBe(
      "◐ considering\n  checking\n  thought for 14s",
    );
  });

  test("reasoning is categorically distinct from ordinary model output", () => {
    const block = reasoningBlock("considering", 3000);
    expect(block[0][0]).toMatchObject({ text: "◐ ", tone: "muted", bold: true });
    expect(block[0][1]).toMatchObject({ text: "considering", tone: "muted", italic: true });
    expect(assistantBlock("considering")[0][0].text).toBe("● ");
  });

  // A thought is shaped like an answer and toned so it cannot be mistaken for
  // one. Before this it was neither: every blank line was dropped and no
  // markdown was applied at all.
  test("it carries the same markdown an answer would", () => {
    const block = reasoningBlock("## Weighing it\nthe **second** option", 1000);
    expect(block[0]).toContainEqual(
      expect.objectContaining({ text: "Weighing it", bold: true, underline: true }),
    );
    expect(block[1]).toContainEqual(expect.objectContaining({ text: "second", bold: true }));
  });

  test("paragraphs survive, and a run of blank lines becomes one", () => {
    expect(text(reasoningBlock("one\n\n\n\ntwo", 1000))).toBe("◐ one\n\n  two\n  thought for 1s");
  });

  test("a blank line is blank, not an indent with nothing after it", () => {
    expect(reasoningBlock("one\n\ntwo", 1000)[1]).toEqual([]);
  });

  // Italic code is harder to read than it is worth, and a fence is the one place
  // the exact characters matter.
  test("fenced code stays upright while the prose around it is italic", () => {
    const block = reasoningBlock("thinking\n```ts\nconst x = 1;\n```", 1000);
    const code = block.find((line) => line.some((span) => span.text.includes("const x = 1;")));
    expect(code?.every((span) => span.italic !== true)).toBe(true);
    expect(block[0][1]).toMatchObject({ italic: true });
  });

  test("every span is muted, whatever the markdown made of it", () => {
    const block = reasoningBlock("## H\n**bold** and `code`", 1000);
    for (const line of block)
      for (const span of line) if (span.text.trim() !== "") expect(span.tone).toBe("muted");
  });

  test("the durable event includes the reasoning text", () => {
    const block = eventBlock({
      type: "reasoning",
      text: "because this follows from that",
      elapsedMs: 3000,
    });
    expect(text(block.lines)).toContain("because this follows from that");
    expect(text(block.lines)).toContain("thought for 3s");
  });

  test("while streaming it shows the tail, so the newest thinking is visible", () => {
    const draft = reasoningDraft("one\ntwo\nthree\nfour\nfive\nsix\nseven\neight");
    expect(draft).toHaveLength(6);
    expect(text(draft)).toContain("eight");
    expect(text(draft)).not.toContain("one");
  });

  test("blank lines are dropped rather than painting empty rows", () => {
    expect(reasoningDraft("a\n\n\nb")).toHaveLength(2);
  });

  test("reasoning is visible by default and can be disabled", () => {
    expect(reasoningVisible(undefined, undefined)).toBe(true);
    expect(reasoningVisible(true, undefined)).toBe(true);
    expect(reasoningVisible(false, "max")).toBe(false);
  });

  test("a level acts as the minimum effort shown", () => {
    expect(reasoningVisible("high", "medium")).toBe(false);
    expect(reasoningVisible("high", "high")).toBe(true);
    expect(reasoningVisible("high", "xhigh")).toBe(true);
    expect(reasoningVisible("high", "max")).toBe(true);
    expect(reasoningVisible("high", undefined)).toBe(false);
  });
});

describe("the activity row", () => {
  const text = (columns: number, phase?: { name: string; ms: number } | null) =>
    statusRow({ busy: true, queued: 0, columns, phase })
      .flat()
      .map((span) => span.text)
      .join("");

  test("it names the phase and how long it has been in it", () => {
    expect(text(120, { name: "waiting", ms: 2300 })).toContain("waiting 2.3s");
  });

  test("without a phase the line is what it always was", () => {
    const bare = text(120, null);
    expect(bare).toContain("Esc interrupt");
    expect(bare).not.toContain("waiting");
  });

  test("the phase leads, so a narrow terminal clips the fixed hint instead", () => {
    expect(text(30, { name: "thinking", ms: 8100 })).toContain("thinking 8.1s");
  });

  test("no row is ever wider than the terminal", () => {
    for (const columns of [12, 24, 40, 80, 200])
      for (const phase of [null, { name: "waiting", ms: 65_000 }])
        expect(text(columns, phase).length).toBeLessThanOrEqual(columns);
  });

  test("a queued count still reaches the line", () => {
    const line = statusRow({
      busy: true,
      queued: 2,
      columns: 140,
      phase: { name: "writing", ms: 400 },
    })
      .flat()
      .map((s) => s.text)
      .join("");
    expect(line).toContain(`2 queued (${dequeueShortcut()} dequeue)`);
    expect(line).toContain("writing 0.4s");
    expect(line.indexOf("queued")).toBeLessThan(line.indexOf("Esc interrupt"));
  });

  test("elapsed stays readable past a minute", () => {
    expect(elapsed(400)).toBe("0.4s");
    expect(elapsed(59_400)).toBe("59.4s");
    expect(elapsed(65_000)).toBe("1m 5s");
  });

  test("an idle turn still paints nothing", () => {
    expect(
      statusRow({ busy: false, queued: 0, columns: 120, phase: { name: "waiting", ms: 100 } })[0][0]
        .text,
    ).toBe("");
  });

  // The block that used to march across every running row, and the sine field
  // that filled this line, carried no information the row did not already have
  // and cost a repaint eleven times a second. Both are gone; the elapsed
  // readings that do carry information stay.
  test("nothing animates: the same inputs paint the same row every time", () => {
    const once = text(120, { name: "waiting", ms: 2300 });
    expect(text(120, { name: "waiting", ms: 2300 })).toBe(once);
    expect(once).not.toMatch(/[▁▂▃▄▅▆▇█]/u);
  });

  test("a running tool row carries a static mark, not a moving one", () => {
    const row = runningRow("bash", "sleep 3")
      .flat()
      .map((span) => span.text)
      .join("");
    expect(row).not.toContain("█");
    expect(row).toContain("bash");
    expect(row).toContain("sleep 3");
  });
});

// The model always received the reason — it is the tool's return value — but
// the transcript showed only `✗ edit 2 files`, so a failure the agent then
// worked around looked, from the outside, like nothing had happened.
// A row is one line now: what was called, what came back, how long it took. It
// was five, which cost sixty lines of scrollback for a turn doing twelve
// things.
describe("the tool row format", () => {
  const text = (lines: Line[]): string =>
    lines.map((line) => line.map((span) => span.text).join("")).join("\n");

  test("a successful call is one line", () => {
    const rows = toolRow("bash", "git status", 1240, true, undefined, "M a.ts", 80, "1 line");
    expect(rows).toHaveLength(1);
    expect(text(rows)).toContain("bash");
    expect(text(rows)).toContain("git status · 1 line");
    expect(text(rows)).toContain("1.2s");
  });

  test("the name sits in a fixed column, so calls line up without coordinating", () => {
    const one = text(toolRow("read", "a.ts", 1, true, undefined, "", 80));
    const two = text(toolRow("bash", "b.sh", 1, true, undefined, "", 80));
    expect(one.indexOf("a.ts")).toBe(two.indexOf("b.sh"));
  });

  test("the tool name is bold, so the call reads before its arguments", () => {
    const name = toolRow("bash", "git status", 1, true)
      .flat()
      .find((span) => span.text.trim() === "bash");
    expect(name?.bold).toBe(true);
  });

  test("the duration is pushed to the right margin", () => {
    const line = text(toolRow("read", "a.ts", 8, true, undefined, "", 60));
    expect(line).toEndWith("8ms");
    expect(line.length).toBeLessThanOrEqual(60);
  });

  // The reason a call failed is the one piece of output nobody should have to
  // go looking for.
  test("a failure earns a second line carrying the reason", () => {
    const rows = toolRow("edit", "a.ts", 24, false, undefined, "ERROR: old_string not found", 80);
    expect(rows).toHaveLength(2);
    expect(text(rows)).toContain("old_string not found");
    expect(text(rows)).not.toContain("ERROR:");
    expect(rows[1][0].tone).toBe("danger");
  });

  test("a running row has no duration — there is nothing to report yet", () => {
    expect(text(runningRow("bash", "sleep 3", undefined, 80)).trim()).toBe("→ bash    sleep 3");
  });

  test("however much came back, the row stays one line", () => {
    const huge = "x".repeat(200).split("").join("\n");
    expect(
      toolRow("bash", "y".repeat(500), 1, true, undefined, huge, 80, "200 lines"),
    ).toHaveLength(1);
  });

  test("no row is ever wider than the terminal", () => {
    for (const columns of [40, 60, 100, 200]) {
      const rows = toolRow(
        "bash",
        "z".repeat(300),
        4200,
        true,
        undefined,
        "",
        columns,
        "y".repeat(300),
      );
      for (const line of text(rows).split("\n")) expect(line.length).toBeLessThanOrEqual(columns);
    }
  });

  test("a tool with nothing to say is still a row", () => {
    expect(text(toolRow("glob", "", 3, true, undefined, "", 80)).trim()).toStartWith("✓ glob");
  });

  // One seam, not two: an extension already describes its tool through
  // renderResult, so that is where the row's summary comes from.
  test("an extension's renderer supplies the summary", () => {
    const rows = toolRow(
      "web_fetch",
      "x",
      3000,
      true,
      [[{ text: "fetched 2 pages" }]],
      "ignored",
      80,
    );
    expect(rows).toHaveLength(1);
    expect(text(rows)).toContain("x · fetched 2 pages");
  });

  test("a renderer wanting more than a line gets more than a line", () => {
    const rows = toolRow(
      "web_fetch",
      "x",
      10,
      true,
      [[{ text: "fetched 2 pages" }], [{ text: "one.com" }]],
      "ignored",
      80,
    );
    expect(rows).toHaveLength(2);
    expect(text(rows)).toContain("one.com");
  });
});

// A run of calls is whatever happened between two things the model said. Live
// rendering and session replay both fold events through the same rule, because
// two views of one session disagreeing about it is exactly the bug this shape
// invites.
describe("the receipt that closes a run of calls", () => {
  const call = (ok = true, elapsedMs = 100) =>
    ({ type: "tool", name: "bash", detail: "x", elapsedMs, ok, input: {}, result: "out" }) as const;
  const text = (lines: Line[]): string =>
    lines.map((line) => line.map((span) => span.text).join("")).join("\n");

  test("it totals the calls and the time they took", () => {
    expect(text(toolGroupFooter(4, 24_000, 0))).toContain("4 calls · 24.0s");
  });

  test("failures are counted where they cannot be missed", () => {
    const footer = toolGroupFooter(4, 100, 1);
    expect(text(footer)).toContain("1 failed");
    expect(footer[0][0].tone).toBe("danger");
  });

  // For one call the row above already says everything the receipt would.
  test("a single call gets no receipt", () => {
    expect(toolGroupFooter(1, 100, 0)).toEqual([]);
  });

  test("a run closes when the model says something", () => {
    let run = NO_TOOL_RUN;
    for (const event of [call(), call()]) run = advanceToolRun(run, event).run;
    const closing = advanceToolRun(run, { type: "assistant", text: "done" });
    expect(text(closing.footer)).toContain("2 calls");
    expect(closing.run).toEqual(NO_TOOL_RUN);
  });

  test("a tool event never closes the run it is part of", () => {
    expect(advanceToolRun(NO_TOOL_RUN, call()).footer).toEqual([]);
  });

  test("replaying a session prints the same receipts the live screen did", () => {
    const events = [call(), call(false), { type: "assistant" as const, text: "ok" }, call()];
    const replayed = text(transcript(events, 100));
    expect(replayed).toContain("2 calls · 200ms · 1 failed");
    // the trailing single call closes at the end of the transcript, and one
    // call earns no receipt
    expect(replayed.match(/calls ·/gu)).toHaveLength(1);
  });
});

describe("the queued count matches the queued rows", () => {
  const spans = (queued: number, columns = 140) =>
    statusRow({ busy: true, queued, columns, phase: { name: "writing", ms: 400 } })[0];

  test("it carries the same tone a queued row does", () => {
    const count = spans(2).find((span) => span.text.includes("queued"));
    expect(count?.tone).toBe("warning");
    expect(queuedRow({ kind: "follow-up", text: "x" })[0].tone).toBe("warning");
  });

  test("the phase and interrupt hint stay accent", () => {
    const accent = spans(2)
      .filter((span) => span.tone === "accent")
      .map((span) => span.text)
      .join("");
    expect(accent).toContain("writing 0.4s");
    expect(accent).toContain("Esc interrupt");
  });

  test("the dequeue shortcut follows the platform", () => {
    expect(dequeueShortcut("darwin")).toBe("Opt+↑");
    expect(dequeueShortcut("win32")).toBe("Alt+↑");
    expect(dequeueShortcut("linux")).toBe("Alt+↑");
  });

  test("no count, no extra span", () => {
    expect(spans(0)).toHaveLength(1);
  });

  // The count is redundant with the rows above it, so it is what goes when
  // there is no room — not the live reading or the way to stop the turn.
  test("a narrow terminal drops the count before the phase", () => {
    const narrow = spans(3, 22)
      .map((span) => span.text)
      .join("");
    expect(narrow).toContain("writing");
    expect(narrow).not.toContain("queued");
    expect(narrow.length).toBeLessThanOrEqual(22);
  });

  test("no row is ever wider than the terminal", () => {
    for (const columns of [10, 18, 24, 60, 200])
      for (const queued of [0, 1, 12])
        expect(
          spans(queued, columns)
            .map((span) => span.text)
            .join("").length,
        ).toBeLessThanOrEqual(columns);
  });
});

// Reported from a live session: a turn ended and the transcript said
// "[object Object]". `String(thrown)` is fine for an Error and useless for
// everything else — and a provider SDK throws plain objects routinely, so a
// failed turn could report literally nothing about why.
describe("what a failure says", () => {
  test("an Error says its message", () => {
    expect(errorText(new Error("no such model"))).toBe("no such model");
  });

  test("a thrown string is the message", () => {
    expect(errorText("rate limited")).toBe("rate limited");
  });

  test("a plain object gives up its message rather than its type", () => {
    expect(errorText({ message: "quota exceeded" })).toBe("quota exceeded");
    expect(errorText({ message: "quota exceeded" })).not.toContain("[object");
  });

  // The shape most providers actually throw.
  test("a nested provider error is unwrapped", () => {
    expect(errorText({ error: { message: "content filter triggered" } })).toBe(
      "content filter triggered",
    );
    expect(errorText({ status: 429, body: { error: { message: "too many requests" } } })).toBe(
      "too many requests",
    );
  });

  test("an empty Error falls through to its cause", () => {
    const outer = new Error("");
    outer.cause = new Error("socket hang up");
    expect(errorText(outer)).toBe("socket hang up");
  });

  test("the first of several is reported", () => {
    expect(errorText({ errors: [{ message: "first" }, { message: "second" }] })).toBe("first");
  });

  // A wall of JSON is worth more than "[object Object]".
  test("something unrecognisable is serialised, never coerced", () => {
    const said = errorText({ code: 17, retryable: false });
    expect(said).toContain("17");
    expect(said).not.toContain("[object");
  });

  test("nothing at all still says something", () => {
    expect(errorText(null)).toBe("an unknown failure");
    expect(errorText(undefined)).toBe("an unknown failure");
  });

  test("a known failure still gets its plainer wording", () => {
    expect(errorText({ message: "The socket connection was closed unexpectedly" })).toContain(
      "continue",
    );
  });

  test("nothing anywhere renders as [object Object]", () => {
    for (const thrown of [{}, { a: {} }, [], new Error(""), { error: {} }])
      expect(errorText(thrown)).not.toContain("[object Object]");
  });
});
