import type { SessionEvent } from "./events";

export type Tone = "accent" | "highlight" | "muted" | "prompt" | "success" | "warning" | "danger";

export type Span = {
  text: string;
  tone?: Tone;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fill?: boolean;
};

export type Line = Span[];

export const errorText = (thrown: unknown): string =>
  thrown instanceof Error ? thrown.message : String(thrown);

const splitter = new Intl.Segmenter("en", { granularity: "grapheme" });

const graphemes = (text: string): string[] =>
  [...splitter.segment(text)].map((piece) => piece.segment);

const wide = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe6f],
  [0xff00, 0xff60],
  [0x1f1e6, 0x1f1ff],
  [0x1f300, 0x1faff],
  [0x1fc00, 0x10ffff],
];

const cells = (grapheme: string): number => {
  const points = [...grapheme].map((char) => char.codePointAt(0) ?? 0);
  if (points.includes(0xfe0f)) return 2;
  return wide.some(([low, high]) => points[0] >= low && points[0] <= high) ? 2 : 1;
};

export const width = (text: string): number =>
  graphemes(text).reduce((sum, part) => sum + cells(part), 0);

const noise = /[\p{Cc}\p{Bidi_Control}]/gu;

const clean = (text: string): string =>
  text.replaceAll("\r", "").replace(noise, (char) => (char === "\n" ? "\n" : " "));

export const flatten = (text: string): string => clean(text).replaceAll("\n", " ").trim();

export const clip = (text: string, limit: number): string => {
  if (limit <= 0) return "";
  if (width(text) <= limit) return text;
  let room = limit - 1;
  let kept = "";
  for (const part of graphemes(text)) {
    room -= cells(part);
    if (room < 0) break;
    kept += part;
  }
  return `${kept}…`;
};

export const rightClip = (text: string, limit: number): string => {
  if (limit <= 0) return "";
  if (width(text) <= limit) return text;
  let room = limit - 1;
  const kept: string[] = [];
  const parts = graphemes(text);
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    room -= cells(parts[index]);
    if (room < 0) break;
    kept.unshift(parts[index]);
  }
  return `…${kept.join("")}`;
};

export const userBlock = (text: string): Line[] => {
  const [lead, ...rest] = clean(text).split("\n");
  return [
    [{ text: " ", fill: true }],
    [
      { text: " ", fill: true },
      { text: "❯", tone: "prompt", bold: true, fill: true },
      { text: ` ${lead}`, bold: true, fill: true },
    ],
    ...rest.map((row): Line => [{ text: ` ${row}`, bold: true, fill: true }]),
    [{ text: " ", fill: true }],
  ];
};

const marked = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|(?<!\w)\*[^\s*][^*]*\*(?!\w))/u;

const inline = (row: string): Line =>
  row
    .split(marked)
    .map((piece, at): Span => {
      if (at % 2 === 0) return { text: piece };
      if (piece.startsWith("**") || piece.startsWith("__")) {
        return { text: piece.slice(2, -2), bold: true };
      }
      const body = piece.slice(1, -1);
      return piece.startsWith("`")
        ? { text: body, tone: "highlight" }
        : { text: body, italic: true };
    })
    .filter((span) => span.text.length > 0);

const heading = /^#{1,4}\s+/u;

const prose = (row: string): Line =>
  heading.test(row)
    ? [{ text: row.replace(heading, ""), bold: true, underline: true }]
    : inline(row);

const fence = /^\s*```/u;

export const assistantBlock = (text: string): Line[] => {
  const rows = clean(text).split("\n");
  const fenced = [...rows.map((row) => fence.test(row)), true];
  let close = -1;
  const lines = rows.map((row, at): Line => {
    if (!fenced[at]) return at < close ? [{ text: row }] : prose(row);
    if (at > close) close = fenced.indexOf(true, at + 1);
    return [{ text: row, tone: "muted" }];
  });
  return lines.with(0, [{ text: "● ", tone: "highlight" }, ...lines[0]]);
};

export const noticeBlock = (text: string, tone: Tone = "muted"): Line[] =>
  clean(text)
    .split("\n")
    .map((row): Line => [{ text: row, tone }]);

const activity = (icon: Span, name: string, detail: string, gap: string): Line => {
  const label = flatten(detail);
  const note: Line = label ? [{ text: `${gap}${clip(label, 80)}`, tone: "muted" }] : [];
  return [{ text: "  " }, icon, { text: ` ${flatten(name)}` }, ...note];
};

export const toolRow = (name: string, detail: string, elapsedMs: number, ok: boolean): Line => {
  const mark: Span = ok ? { text: "✓", tone: "success" } : { text: "✗", tone: "danger" };
  const took =
    elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${Math.round(elapsedMs)}ms`;
  return [...activity(mark, name, detail, "  "), { text: `  ${took}`, tone: "muted" }];
};

// Reasoning collapses once the answer starts: what matters afterwards is that it
// happened and for how long, not a wall of text already read past. The full text
// stays in the event.
export const reasoningBlock = (elapsedMs: number): Line[] => [
  [{ text: `░ thought for ${Math.max(1, Math.round(elapsedMs / 1000))}s`, tone: "muted" }],
];

// What is painted while reasoning is still arriving, before the collapse.
export const reasoningDraft = (text: string): Line[] =>
  clean(text)
    .split("\n")
    .filter((line) => line.trim() !== "")
    .slice(-6)
    .map((line): Line => [{ text: `░ ${line}`, tone: "muted", italic: true }]);

export const eventBlock = (event: SessionEvent): { lines: Line[]; gap: boolean } => {
  switch (event.type) {
    case "user":
      return { lines: userBlock(event.text), gap: true };
    case "assistant":
      return { lines: assistantBlock(event.text), gap: true };
    case "tool":
      return { lines: [toolRow(event.name, event.detail, event.elapsedMs, event.ok)], gap: false };
    case "reasoning":
      return { lines: reasoningBlock(event.elapsedMs), gap: true };
    case "notice":
      return { lines: noticeBlock(event.text), gap: false };
    case "error":
      return { lines: noticeBlock(event.text, "danger"), gap: false };
    default:
      return { lines: [], gap: false };
  }
};

export const transcript = (events: readonly SessionEvent[]): Line[] =>
  events.flatMap((event) => eventBlock(event).lines);

const sweep = (frame: number): string => {
  const step = Math.abs(frame) % 16;
  const phase = step > 8 ? 16 - step : step;
  return Array.from({ length: 5 }, (_, cell) => {
    const behind = phase - cell;
    return behind >= 0 && behind <= 4 ? "█" : " ";
  }).join("");
};

export const runningRow = (name: string, detail: string, frame: number): Line =>
  activity({ text: sweep(frame), tone: "accent" }, name, detail, " ");

export const queuedRow = (text: string): Line => [
  { text: `  ↳ queued: ${clip(flatten(text), 64)}`, tone: "warning" },
];

const water = " ▁▂▃▄▅▆▇█";

const tokenCount = (tokens: number | null): string => {
  if (tokens === null) return "unknown";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.max(0, Math.round(tokens))}`;
};

export const statusLine = (
  state: {
    model: string;
    tokens: number | null;
    percentUsed: number | null;
  },
  columns: number,
): Line[] => {
  const limit = Math.max(0, Math.floor(columns));
  const percent = state.percentUsed === null ? "unknown" : `${Math.round(state.percentUsed)}%`;
  const line = `${flatten(state.model)} · ctx ${tokenCount(state.tokens)}(${percent})`;
  return [[{ text: clip(line, limit), tone: "muted" }]];
};

// How long the current phase has been running. Seconds carry a decimal so a
// short one is still visibly moving; past a minute the decimal is noise.
export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

export const statusWave = (
  frame: number,
  busy: boolean,
  queued: number,
  columns: number,
  phase?: { name: string; ms: number } | null,
): Line[] => {
  const limit = Math.max(0, Math.floor(columns));
  if (!busy || limit === 0) return [[{ text: "" }]];
  const waiting = queued > 0 ? ` · ${queued} queued` : "";
  // The phase leads: it is the part that changes, and on a narrow terminal the
  // clip should eat the fixed hint rather than the live one.
  const state = phase ? `${phase.name} ${elapsed(phase.ms)} · ` : "";
  const hint = `${state}Esc interrupt${waiting}`;
  const room = Math.max(0, limit - width(hint) - 2);
  const waves = Array.from({ length: room }, (_, index) => {
    const primary = Math.sin(index / 3 + frame / 5);
    const ripple = Math.sin(index / 1.7 - frame / 8) * 0.8;
    const height = Math.max(0, Math.min(water.length - 1, Math.round(4 + primary * 3.5 + ripple)));
    return water[height];
  }).join("");
  // On a narrow terminal the field loses to the hint, and the separator has to
  // go with it or the row is two columns wider than the screen.
  const separator = room === 0 ? "" : "  ";
  return [
    [
      { text: waves.slice(0, room), tone: "accent" },
      { text: separator },
      { text: clip(hint, Math.max(0, limit - room - separator.length)), tone: "accent" },
    ],
  ];
};
