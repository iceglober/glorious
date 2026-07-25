import { describe, expect, test } from "bun:test";
import type { ChatEvent } from "../chat/events";
import type { UiLine, UiSpan, UiTone } from "./styles";
import {
  renderToolRow,
  renderTranscriptItem,
  type ToolOutcome,
  type TranscriptItem,
  toTranscriptItem,
} from "./transcript-item";

const WIDTH = 80;

/** Flatten a block's spans so tests can assert on plain span shapes. */
const spans = (line: UiLine): readonly UiSpan[] => line;

describe("renderTranscriptItem spacing + block per kind", () => {
  const cases: Array<{ item: TranscriptItem; spacing: "none" | "turn" }> = [
    { item: { kind: "user", text: "hi" }, spacing: "turn" },
    { item: { kind: "assistant", body: "done." }, spacing: "turn" },
    { item: { kind: "empty" }, spacing: "turn" },
    { item: { kind: "tool", row: { tool: "read", detail: "x", outcome: "ok" } }, spacing: "none" },
    { item: { kind: "error", text: "error: boom" }, spacing: "none" },
    { item: { kind: "notice", text: "hello" }, spacing: "none" },
    { item: { kind: "dequeued", text: "(dequeued) later" }, spacing: "none" },
  ];

  for (const { item, spacing } of cases) {
    test(`${item.kind} → spacing ${spacing}`, () => {
      const rendered = renderTranscriptItem(item, WIDTH);
      expect(rendered.spacing).toBe(spacing);
      expect(rendered.block.length).toBeGreaterThan(0);
    });
  }

  test("an assistant response is anchored with a leading accent marker", () => {
    const { block, spacing } = renderTranscriptItem({ kind: "assistant", body: "shipped" }, WIDTH);
    expect(spacing).toBe("turn");
    expect(block[0]?.[0]).toEqual({ text: "● ", tone: "accent" });
  });

  test("a step-limited response appends the resume notice under the body", () => {
    const { block } = renderTranscriptItem(
      { kind: "assistant", body: "partial work", stepLimitReached: true },
      WIDTH,
    );
    const text = block.flatMap((line) => spans(line).map((span) => span.text)).join("");
    expect(text).toContain("partial work");
    expect(text).toContain("step limit reached");
  });

  test("empty response is a single muted notice line", () => {
    const { block } = renderTranscriptItem({ kind: "empty" }, WIDTH);
    expect(block).toEqual([
      [{ text: "(no response — the model returned nothing; try again)", tone: "muted" }],
    ]);
  });

  test("an error line is toned danger; its hint trails muted", () => {
    expect(renderTranscriptItem({ kind: "error", text: "error: boom" }, WIDTH).block).toEqual([
      [{ text: "error: boom", tone: "danger" }],
    ]);
    const { block } = renderTranscriptItem(
      { kind: "error", text: "error: filtered", hint: "retry once" },
      WIDTH,
    );
    expect(block).toEqual([
      [{ text: "error: filtered", tone: "danger" }],
      [{ text: "retry once", tone: "muted" }],
    ]);
  });

  test("a toned notice colors every line; an untoned one stays plain", () => {
    expect(
      renderTranscriptItem({ kind: "notice", text: "a\nb", tone: "danger" }, WIDTH).block,
    ).toEqual([[{ text: "a", tone: "danger" }], [{ text: "b", tone: "danger" }]]);
    expect(renderTranscriptItem({ kind: "notice", text: "a" }, WIDTH).block).toEqual([
      [{ text: "a" }],
    ]);
  });
});

describe("renderToolRow — only the glyph carries tone", () => {
  const glyphs: Record<Exclude<ToolOutcome, "running">, { glyph: string; tone: UiTone }> = {
    ok: { glyph: "✓", tone: "success" },
    fail: { glyph: "✗", tone: "danger" },
    blocked: { glyph: "⊘", tone: "warning" },
  };

  for (const outcome of ["ok", "fail", "blocked"] as const) {
    test(`${outcome} row tones only the glyph`, () => {
      const [line] = renderToolRow(
        { tool: "read", detail: "src/x.ts", elapsedMs: 1_200, outcome },
        { live: false },
        WIDTH,
      );
      const list = spans(line);
      const glyphSpan = list.find((span) => span.text === glyphs[outcome].glyph);
      expect(glyphSpan?.tone).toBe(glyphs[outcome].tone);
      // The tool name is default weight, untoned.
      const toolSpan = list.find((span) => span.text === "read");
      expect(toolSpan?.tone).toBeUndefined();
      expect(toolSpan?.bold).toBeUndefined();
      // Detail and duration are muted — never the outcome tone.
      const detail = list.find((span) => span.text.includes("src/x.ts"));
      const duration = list.find((span) => span.text.includes("1.2s"));
      expect(detail?.tone).toBe("muted");
      expect(duration?.tone).toBe("muted");
      // No span other than the glyph carries the outcome tone.
      expect(list.filter((span) => span.tone === glyphs[outcome].tone)).toHaveLength(1);
    });
  }

  test("live rows use the accent spinner glyph", () => {
    const [line] = renderToolRow(
      { tool: "read", detail: "", outcome: "ok" },
      { live: true },
      WIDTH,
    );
    expect(spans(line).find((span) => span.text === "▌")?.tone).toBe("accent");
  });

  test("a row is one line: no detail span when blank, multi-line detail flattened", () => {
    const bare = renderToolRow(
      { tool: "read", detail: "  ", outcome: "ok" },
      { live: false },
      WIDTH,
    );
    expect(bare).toHaveLength(1);
    expect(spans(bare[0]).map((span) => span.text)).toEqual(["  ", "✓", " ", "read"]);

    const wrapped = renderToolRow(
      { tool: "bash", detail: "git status\n--short", outcome: "ok" },
      { live: false },
      WIDTH,
    );
    expect(wrapped).toHaveLength(1);
    const detail = spans(wrapped[0]).find((span) => span.text.includes("git status"));
    expect(detail?.text).not.toContain("\n");
    expect(detail?.text).toContain("git status --short");
  });
});

describe("toTranscriptItem", () => {
  const item = (event: ChatEvent): TranscriptItem | null => toTranscriptItem(event);

  test("a started turn carries its transcript override when present", () => {
    expect(item({ type: "turn-started", text: "hi" })).toEqual({ kind: "user", text: "hi" });
    expect(item({ type: "turn-started", text: "hi", transcriptText: "> hi" })).toEqual({
      kind: "user",
      text: "hi",
      transcriptText: "> hi",
    });
  });

  test("assistant text is trimmed; a blank response becomes the empty item", () => {
    expect(item({ type: "assistant", text: "  done.  " })).toEqual({
      kind: "assistant",
      body: "done.",
    });
    expect(item({ type: "assistant", text: "   " })).toEqual({ kind: "empty" });
    // A blank but step-limited turn still renders the notice, not "empty".
    expect(item({ type: "assistant", text: "", stepLimitReached: true })).toEqual({
      kind: "assistant",
      body: "",
      stepLimitReached: true,
    });
  });

  test("a content-filter failure gets the retry hint; other errors do not", () => {
    const filtered = item({
      type: "turn-error",
      error: "the response was filtered by the content management policy",
    });
    expect(filtered?.kind).toBe("error");
    expect((filtered as { hint?: string }).hint).toContain("content filter");
    const plain = item({ type: "turn-error", error: "socket hang up" });
    expect(plain).toEqual({ kind: "error", text: "error: socket hang up" });
  });

  test("aborted, notice, and dequeued turns render as one-liners", () => {
    expect(item({ type: "turn-aborted" })).toEqual({ kind: "notice", text: "(turn interrupted)" });
    expect(item({ type: "notice", text: "cleared" })).toEqual({ kind: "notice", text: "cleared" });
    expect(item({ type: "turn-dequeued", text: "run tests\nand more" })).toEqual({
      kind: "dequeued",
      text: "(dequeued) run tests",
    });
    // The restore text wins over the display text when both are present.
    expect(item({ type: "turn-dequeued", text: "shown", restoreText: "original" })).toEqual({
      kind: "dequeued",
      text: "(dequeued) original",
    });
  });

  test("plumbing events render nothing", () => {
    for (const event of [
      { type: "turn-queued", text: "later" },
      { type: "turn-abort-requested" },
      { type: "turn-finished" },
      { type: "submission-finished" },
    ] satisfies ChatEvent[]) {
      expect(item(event)).toBeNull();
    }
  });
});
