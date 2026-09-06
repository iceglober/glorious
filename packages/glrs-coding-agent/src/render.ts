import type { Activity, Span, Tone } from "../../glrs-core/src";
import {
  clean,
  clip,
  describeThrown,
  errorText,
  flatten,
  type Line,
  rightClip,
  width,
} from "../../glrs-core/src/display";
import type { SessionEvent } from "../../glrs-core/src/events";
import { resultSummary } from "../../glrs-core/src/toolkit";
import {
  REASONING_LEVELS,
  type ReasoningDisplay,
  type ReasoningLevel,
} from "../../glrs-providers/src/config";

// Declared in glrs-core, where extensions reach it.
export type { Span, Tone } from "../../glrs-core/src";
export type { Activity };
export { clean, clip, describeThrown, errorText, flatten, type Line, rightClip, width };

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

// Markdown rows: headings, emphasis and code spans everywhere except inside a
// fence, where the text is kept exactly as written. Shared, so an answer and a
// thought are shaped the same way and differ only in how they are toned.
// `code` travels beside the line because whether a row was inside a fence is not
// recoverable from its spans, and a thought needs to know: fenced text stays
// upright when everything around it goes italic.
type Shaped = { line: Line; code: boolean };

const shaped = (text: string): Shaped[] => {
  const rows = clean(text).split("\n");
  const fenced = [...rows.map((row) => fence.test(row)), true];
  let close = -1;
  return rows.map((row, at): Shaped => {
    if (!fenced[at])
      return at < close ? { line: [{ text: row }], code: true } : { line: prose(row), code: false };
    if (at > close) close = fenced.indexOf(true, at + 1);
    return { line: [{ text: row, tone: "muted" }], code: true };
  });
};

export const assistantBlock = (text: string): Line[] => {
  const lines = shaped(text).map((one) => one.line);
  return lines.with(0, [{ text: "● ", tone: "highlight" }, ...lines[0]]);
};

export const noticeBlock = (text: string, tone: Tone = "muted"): Line[] =>
  clean(text)
    .split("\n")
    .map((row): Line => [{ text: row, tone }]);

// What the model keeps after a compaction, shown rather than described. The
// header says what it cost; the brief itself reads as prose, because that is
// what it is and skipping it should be as easy as skipping any other answer.
export const compactedBlock = (summary: string, dropped: number): Line[] => [
  [
    {
      text: `▣ compacted, ${dropped} messages replaced by this brief`,
      tone: "accent",
      bold: true,
    },
  ],
  ...clean(summary)
    .split("\n")
    .map((row): Line => [{ text: row, tone: "muted" }]),
];

// A tool row is one line. What was called, what came back, how long it took:
//
//   ✓ read   v2/render.ts · 432 lines                            8ms
//   ✓ grep   "toolRow" in v2/ · 2 matches                      124ms
//   ✗ edit   v2/render.ts                                       24ms
//     old_string not found in file
//   ✓ bash   bun test --timeout 60000 · 308 pass               23.8s
//   └ 4 calls · 24.0s · 1 failed
//
// It was five lines per call, which meant a turn doing twelve things cost sixty
// lines of scrollback to carry maybe three facts worth having. The tool name
// gets a fixed column so the calls line up down the page without any row having
// to know about the others — the alignment is free, and nothing has to be
// buffered or redrawn to get it.
//
// The result is a summary rather than its tail: `432 lines`, not the last three
// lines of the file. Tools describe their own output (see resultSummary), and a
// tool from an extension describes itself through renderResult, whose first
// line is what lands here.
//
// Only a failure earns a second line, because the reason a call failed is the
// one piece of output nobody wants to go looking for. The footer closes the
// group and is the receipt for it — it says how much the agent just did, which
// no individual row can.
const NAME_COLUMN = 7;
const SUMMARY_CHARS = 90;
// What the row is clamped against when the caller does not say. Every real
// caller passes the terminal's width.
const DEFAULT_COLUMNS = 140;
const INDENT = "    ";

const took = (elapsedMs: number): string =>
  elapsedMs >= 1000 ? `${(elapsedMs / 1000).toFixed(1)}s` : `${Math.round(elapsedMs)}ms`;

// The call and what came back, joined. `detail` is the arguments, `summary` is
// the result — together they read as the sentence the call was.
const said = (detail: string, summary: string): string =>
  [flatten(detail), flatten(summary)].filter((part) => part !== "").join(" · ");

// One line: mark, name in its column, the call, and the duration pushed to the
// right margin. The duration goes last because it is what you check after
// reading what happened, and it lands in space the row was not using.
const row = (
  mark: Span,
  name: string,
  body: string,
  elapsedMs: number | null,
  columns: number,
): Line => {
  const label = flatten(name);
  const gutter = 2 + 1 + 1 + Math.max(NAME_COLUMN, width(label)) + 1;
  const timing = elapsedMs === null ? "" : took(elapsedMs);
  const room = Math.max(8, Math.min(SUMMARY_CHARS, columns - gutter - width(timing) - 2));
  const text = clip(body, room);
  const pad = Math.max(1, columns - gutter - width(text) - width(timing) - 1);
  return [
    { text: "  " },
    mark,
    { text: " " },
    { text: label.padEnd(NAME_COLUMN), bold: true },
    { text: " " },
    { text, tone: "muted" },
    ...(timing === "" ? [] : [{ text: `${" ".repeat(pad)}${timing}`, tone: "muted" as const }]),
  ];
};

// The reason a call failed, on its own line under it. Never a tail of output:
// what is wanted here is the sentence explaining the ✗, and tools already put
// that first.
const reason = (result: string): Line[] => {
  const first = clean(result.replace(/^ERROR:\s*/u, ""))
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line !== "");
  return first === undefined
    ? []
    : [[{ text: `${INDENT}${clip(first, SUMMARY_CHARS)}`, tone: "danger" }]];
};

export const toolRow = (
  name: string,
  detail: string,
  elapsedMs: number,
  ok: boolean,
  custom?: Line[],
  result?: string,
  columns: number = DEFAULT_COLUMNS,
  summary = "",
): Line[] => {
  const mark: Span = ok ? { text: "✓", tone: "success" } : { text: "✗", tone: "danger" };
  // An extension's renderResult replaces what the row says came back. Its first
  // line is the summary; a renderer that wants more than a line gets more than
  // a line, under the row, the way a failure does.
  const [lead, ...rest] = custom ?? [];
  const shown = lead === undefined ? summary : lead.map((span) => span.text).join("");
  return [
    row(mark, name, said(detail, shown), elapsedMs, columns),
    ...rest.map((line): Line => [{ text: INDENT }, ...line]),
    ...(ok || result === undefined ? [] : reason(result)),
  ];
};

// A run of calls is whatever happened between two things the model said. Live
// rendering, session replay and transcript() each need to know where one ends,
// and each knowing separately is how two views of the same session end up
// disagreeing — so the rule is here and they fold events through it.
export type ToolRun = { calls: number; elapsedMs: number; failed: number };

export const NO_TOOL_RUN: ToolRun = { calls: 0, elapsedMs: 0, failed: 0 };

export const advanceToolRun = (
  run: ToolRun,
  event: SessionEvent,
): { run: ToolRun; footer: Line[] } =>
  event.type === "tool"
    ? {
        run: {
          calls: run.calls + 1,
          elapsedMs: run.elapsedMs + event.elapsedMs,
          failed: run.failed + (event.ok ? 0 : 1),
        },
        footer: [],
      }
    : {
        run: NO_TOOL_RUN,
        footer: run.calls > 0 ? toolGroupFooter(run.calls, run.elapsedMs, run.failed) : [],
      };

// The receipt for a run of calls. Only worth drawing for more than one — for a
// single call the row above it already says everything this would.
export const toolGroupFooter = (calls: number, elapsedMs: number, failed: number): Line[] =>
  calls < 2
    ? []
    : [
        [
          {
            text: `  └ ${calls} calls · ${took(elapsedMs)}${failed > 0 ? ` · ${failed} failed` : ""}`,
            tone: failed > 0 ? "danger" : "muted",
          },
        ],
      ];

export const reasoningVisible = (
  display: ReasoningDisplay | undefined,
  variant: string | undefined,
): boolean => {
  if (display === false) return false;
  if (display === true || display === undefined) return true;
  const threshold = REASONING_LEVELS.indexOf(display);
  const effort = REASONING_LEVELS.indexOf(variant?.toLowerCase() as ReasoningLevel);
  return effort >= threshold;
};

// Provider-supplied reasoning remains in the transcript by default. It is
// visually quieter than the answer but never discarded merely because the
// answer began.
// A thought reads like an answer and must not be mistaken for one. It gets the
// same shaping, then every span is muted: the structure is what makes it
// readable, the tone is what keeps the two apart. Code spans stay upright,
// because italic code is harder to read than it is worth.
const dimmed = ({ line, code }: Shaped): Line =>
  line.map((span) => ({
    ...span,
    tone: "muted" as const,
    italic: !code && span.tone !== "highlight",
  }));

// Blank rows survive, so paragraphs still break, but a run of them collapses to
// one and the edges are trimmed. Reasoning arrives with far more whitespace
// than an answer does.
const collapsed = (rows: Shaped[]): Shaped[] =>
  rows.filter(
    (one, at, all) =>
      one.line.length > 0 || (at > 0 && at < all.length - 1 && all[at - 1].line.length > 0),
  );

export const reasoningBlock = (text: string, elapsedMs: number): Line[] => {
  const rows = collapsed(shaped(text));
  const content: Line[] = rows.map((one, index) => {
    const line = dimmed(one);
    // A blank row stays blank rather than becoming two spaces of nothing.
    if (line.length === 0) return [];
    return index === 0
      ? [{ text: "◐ ", tone: "muted" as const, bold: true }, ...line]
      : [{ text: "  " }, ...line];
  });
  return [
    ...content,
    [{ text: `  thought for ${Math.max(1, Math.round(elapsedMs / 1000))}s`, tone: "muted" }],
  ];
};

/** Plain rendering used by print mode, preserving the same visual hierarchy. */
export const reasoningText = (text: string, elapsedMs: number): string =>
  reasoningBlock(text, elapsedMs)
    .map((line) => line.map((span) => span.text).join(""))
    .join("\n");

// What is painted while reasoning is still arriving, before the collapse.
export const reasoningDraft = (text: string): Line[] =>
  collapsed(shaped(text))
    .filter((one) => one.line.length > 0)
    .slice(-6)
    .map((one): Line => [{ text: "░ ", tone: "muted" }, ...dimmed(one)]);

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
  columns: number = DEFAULT_COLUMNS,
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
          columns,
          resultSummary(event.name, event.result ?? "", event.ok),
        ),
        gap: false,
      };
    case "reasoning":
      return { lines: reasoningBlock(event.text, event.elapsedMs), gap: true };
    // The brief is what the model carries forward in place of everything that
    // was dropped. It was announced and then rendered as nothing, so a
    // compaction was a line saying a number of messages went away and no way to
    // see what survived them.
    case "compacted":
      return { lines: compactedBlock(event.summary, event.dropped), gap: true };
    case "notice":
      return { lines: noticeBlock(event.text), gap: false };
    case "error":
      return { lines: noticeBlock(event.text, "danger"), gap: false };
    default:
      return { lines: [], gap: false };
  }
};

export const transcript = (
  events: readonly SessionEvent[],
  columns: number = DEFAULT_COLUMNS,
): Line[] => {
  let run = NO_TOOL_RUN;
  const lines: Line[] = [];
  for (const event of events) {
    const stepped = advanceToolRun(run, event);
    run = stepped.run;
    lines.push(...stepped.footer, ...eventBlock(event, undefined, columns).lines);
  }
  return [...lines, ...toolGroupFooter(run.calls, run.elapsedMs, run.failed)];
};

// A static mark, where a five-cell block used to march back and forth. A row
// that is present already says the call is running; the marching said nothing
// the row did not, eleven times a second.
// No duration yet — there is nothing to report until it finishes, and a number
// counting up in place is the animation this deliberately does not have.
export const runningRow = (
  name: string,
  detail: string,
  custom?: Line[],
  columns: number = DEFAULT_COLUMNS,
): Line[] => {
  const icon: Span = { text: "→", tone: "accent" };
  const [lead, ...rest] = custom ?? [];
  const shown = lead === undefined ? "" : lead.map((span) => span.text).join("");
  return [
    row(icon, name, said(detail, shown), null, columns),
    ...rest.map((line): Line => [{ text: INDENT }, ...line]),
  ];
};

// One waiting message. The kind leads because it is what decides when the
// message lands, and it is the thing you would want to catch if you pressed the
// wrong chord.
export const queuedRow = (entry: { kind: "steer" | "follow-up"; text: string }): Line => [
  {
    text: `  ↳ ${entry.kind === "steer" ? "steering" : "queued"}: ${clip(flatten(entry.text), 64)}`,
    tone: "warning",
  },
];

// Esc stopped the turn and the queue with it. The rows above already say what
// is waiting; this says why none of it is moving and what makes it move again.
export const heldRow = (waiting: number): Line => [
  {
    text: `  ⏸ ${waiting} held, Enter releases · Alt+Up takes the last one back`,
    tone: "warning",
  },
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

/** Platform-native shortcut shown for returning a queued message to the composer. */
export const dequeueShortcut = (platform: NodeJS.Platform = process.platform): string =>
  `${platform === "darwin" ? "Opt" : "Alt"}+↑`;

export const statusRow = ({ busy, queued, columns, phase }: Activity): Line[] => {
  const limit = Math.max(0, Math.floor(columns));
  if (!busy || limit === 0) return [[{ text: "" }]];
  const lead = phase ? `${phase.name} ${elapsed(phase.ms)} · ` : "";
  const stop = "Esc interrupt";
  const core = `${lead}${stop}`;
  // The same warning tone the queued rows above carry, so one glance ties the
  // count to the rows it is counting and says how to take one back.
  const waiting = queued > 0 ? `${queued} queued (${dequeueShortcut()} dequeue) · ` : "";
  // The phase leads: it is the part that changes, so a narrow terminal drops
  // the count — which the queued rows already show — before it eats the live
  // reading or the hint for stopping.
  if (width(core) + width(waiting) <= limit) {
    if (waiting === "") return [[{ text: core, tone: "accent" }]];
    return [
      [
        ...(lead === "" ? [] : [{ text: lead, tone: "accent" as const }]),
        { text: waiting, tone: "warning" },
        { text: stop, tone: "accent" },
      ],
    ];
  }
  return [[{ text: clip(core, limit), tone: "accent" }]];
};
