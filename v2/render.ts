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

// Runtime and provider messages that mean something to whoever wrote them and
// nothing to whoever is using a coding agent. The Bun one tells you to pass
// `verbose: true` to a fetch you never called; a mid-stream drop is not
// retryable here (tokens may already be on screen), so the least glorious can
// do is say what happened.
const clearer: ReadonlyArray<[RegExp, string]> = [
  [
    /socket connection was closed unexpectedly/iu,
    'the connection to the model dropped mid-response — send "continue" to pick up where it stopped',
  ],
  [/^fetch failed$/iu, "could not reach the model — check the network and try again"],
  [/ECONNREFUSED/u, "the model endpoint refused the connection — check the host and port"],
  [/EAI_AGAIN|ENOTFOUND/u, "could not resolve the model host — check DNS and the resource name"],
];

export const errorText = (thrown: unknown): string => {
  const raw = thrown instanceof Error ? thrown.message : String(thrown);
  return clearer.find(([pattern]) => pattern.test(raw))?.[1] ?? raw;
};

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

export const clean = (text: string): string =>
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

// A tool row is three parts, each on its own line:
//
//   ✓ bash  1.2s
//     git status --short
//     M v2/render.ts
//
// The header carries only what is true at a glance — did it work, what was it,
// how long did it take — and the duration appears only once there is one. The
// arguments and the tail of the output sit under it, indented and clamped, so a
// row stays a row: a 30k result contributes three lines, never thirty.
const ARG_CHARS = 140;
const OUTPUT_CHARS = 140;
const OUTPUT_LINES = 3;
const INDENT = "    ";

const header = (icon: Span, name: string, took?: string): Line => [
  { text: "  " },
  icon,
  { text: ` ${flatten(name)}` },
  ...(took === undefined ? [] : [{ text: `  ${took}`, tone: "muted" as const }]),
];

const argRow = (detail: string): Line[] => {
  const said = flatten(detail);
  return said === "" ? [] : [[{ text: `${INDENT}${clip(said, ARG_CHARS)}`, tone: "muted" }]];
};

// The tail, not the head: a command's last lines are the ones that say how it
// ended. Blank lines are dropped so three lines of output means three lines
// worth reading.
const outputRows = (result: string, ok: boolean): Line[] =>
  clean(result.replace(/^ERROR:\s*/u, ""))
    .split("\n")
    .map((row) => row.trim())
    .filter((row) => row !== "")
    .slice(-OUTPUT_LINES)
    .map(
      (row): Line => [
        { text: `${INDENT}${clip(row, OUTPUT_CHARS)}`, tone: ok ? "muted" : "danger" },
      ],
    );

export const toolRow = (
  name: string,
  detail: string,
  elapsedMs: number,
  ok: boolean,
  custom?: Line[],
  result?: string,
): Line[] => {
  const mark: Span = ok ? { text: "✓", tone: "success" } : { text: "✗", tone: "danger" };
  const took =
    elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${Math.round(elapsedMs)}ms`;
  const body =
    custom && custom.length > 0
      ? custom.map((line): Line => [{ text: INDENT }, ...line])
      : [...argRow(detail), ...(result === undefined ? [] : outputRows(result, ok))];
  return [header(mark, name, took), ...body];
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

// `custom` looks up an extension's renderer by tool name. It is resolved at
// paint time rather than stored on the event, so a session replays with
// whatever extensions are installed now — which is right: the extension owns
// its rendering, and one that has been removed should not leave rows behind
// that nothing can explain.
export type ToolRender = (
  name: string,
  input: Record<string, unknown>,
  result: string,
  ok: boolean,
) => Line[] | undefined;

export const eventBlock = (
  event: SessionEvent,
  custom?: ToolRender,
): { lines: Line[]; gap: boolean } => {
  switch (event.type) {
    case "user":
      return { lines: userBlock(event.text), gap: true };
    case "assistant":
      return { lines: assistantBlock(event.text), gap: true };
    case "tool":
      return {
        lines: toolRow(
          event.name,
          event.detail,
          event.elapsedMs,
          event.ok,
          custom?.(event.name, event.input ?? {}, event.result ?? "", event.ok),
          event.result,
        ),
        gap: false,
      };
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

// A static mark, where a five-cell block used to march back and forth. A row
// that is present already says the call is running; the marching said nothing
// the row did not, eleven times a second.
// No duration yet — there is nothing to report until it finishes, and a number
// counting up in place is the animation this deliberately does not have.
export const runningRow = (name: string, detail: string, custom?: Line[]): Line[] => {
  const icon: Span = { text: "→", tone: "accent" };
  const body =
    custom && custom.length > 0
      ? custom.map((line): Line => [{ text: INDENT }, ...line])
      : argRow(detail);
  return [header(icon, name), ...body];
};

export const queuedRow = (text: string): Line => [
  { text: `  ↳ queued: ${clip(flatten(text), 64)}`, tone: "warning" },
];

const tokenCount = (tokens: number | null): string => {
  if (tokens === null) return "unknown";
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.max(0, Math.round(tokens))}`;
};

// Extension segments trail the model and context, so the fixed part of the line
// keeps its position no matter what is installed.
export const statusLine = (
  state: {
    model: string;
    tokens: number | null;
    percentUsed: number | null;
    segments?: readonly string[];
  },
  columns: number,
): Line[] => {
  const limit = Math.max(0, Math.floor(columns));
  const percent = state.percentUsed === null ? "unknown" : `${Math.round(state.percentUsed)}%`;
  const line = [
    `${flatten(state.model)} · ctx ${tokenCount(state.tokens)}(${percent})`,
    ...(state.segments ?? []).map(flatten).filter((segment) => segment !== ""),
  ].join(" · ");
  return [[{ text: clip(line, limit), tone: "muted" }]];
};

// How long the current phase has been running. Seconds carry a decimal so a
// short one is still visibly moving; past a minute the decimal is noise.
export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, ms) / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
};

// What the model is doing and for how long, plus how to stop it. This used to
// be that text pinned to the right of a full-width animated sine field; the
// field carried no information and cost a repaint on every one of eleven frames
// a second. The phase leads because it is the part that changes, so a narrow
// terminal clips the fixed hint rather than the live reading.
// What the turn is doing, and how to stop it. The state an extension replacing
// this row is handed.
export type Activity = {
  busy: boolean;
  queued: number;
  columns: number;
  phase?: { name: string; ms: number } | null;
};

export const statusRow = ({ busy, queued, columns, phase }: Activity): Line[] => {
  const limit = Math.max(0, Math.floor(columns));
  if (!busy || limit === 0) return [[{ text: "" }]];
  const head = `${phase ? `${phase.name} ${elapsed(phase.ms)} · ` : ""}Esc interrupt`;
  // The same warning tone the queued rows above carry, so one glance ties the
  // count to the rows it is counting.
  const waiting: Line = queued > 0 ? [{ text: ` · ${queued} queued`, tone: "warning" }] : [];
  // The phase leads: it is the part that changes, so a narrow terminal drops the
  // count — which the queued rows already show — before it eats the live
  // reading or the hint for stopping.
  if (width(head) + width(waiting[0]?.text ?? "") <= limit)
    return [[{ text: head, tone: "accent" }, ...waiting]];
  return [[{ text: clip(head, limit), tone: "accent" }]];
};
