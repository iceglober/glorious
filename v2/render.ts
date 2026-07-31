export type Tone = "accent" | "muted" | "success" | "warning" | "danger";

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

const flatten = (text: string): string => clean(text).replaceAll("\n", " ").trim();

const clip = (text: string, limit: number): string => {
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

export const userBlock = (text: string): Line[] => {
  const [lead, ...rest] = clean(text).split("\n");
  return [
    [{ text: " ", fill: true }],
    [
      { text: " ", fill: true },
      { text: "❯", tone: "accent", bold: true, fill: true },
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
      return piece.startsWith("`") ? { text: body, tone: "accent" } : { text: body, italic: true };
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
  return lines.with(0, [{ text: "● ", tone: "accent" }, ...lines[0]]);
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

const ramp = "▁▂▃▄▅▆▇█";

const vuMeter = (frame: number): string =>
  Array.from({ length: 5 }, (_, bar) => {
    const turns = (frame + bar * 2.5) / 11;
    return ramp[Math.round((1 - Math.cos(turns * 2 * Math.PI)) * 3.5)];
  }).join("");

const tokenCount = (tokens: number): string => {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}m`;
  if (tokens >= 1000) return `${(tokens / 1000).toFixed(1)}k`;
  return `${Math.max(0, Math.round(tokens))}`;
};

export const statusLine = (
  state: {
    root: string;
    model: string;
    tokens: number;
    busy: boolean;
    queued: number;
    frame: number;
  },
  columns: number,
): Line => {
  const limit = Math.max(0, Math.floor(columns));
  const waiting = state.queued > 0 ? ` · ${state.queued} queued` : "";
  const hint = state.busy ? `   ${vuMeter(state.frame)}  Esc interrupt${waiting}` : "";
  const room = Math.max(0, limit - width(hint));
  const root = flatten(state.root);
  const ctx = `ctx ${tokenCount(state.tokens)}`;
  const named = `${flatten(state.model)} · ${ctx}`;
  const ladder = [
    `${root} · ${named}`,
    `…${root.slice(root.lastIndexOf("/") + 1)} · ${named}`,
    named,
    ctx,
  ];
  const body = ladder.find((option) => width(option) <= room) ?? ctx;
  const line: Line = [{ text: clip(body, room), tone: "muted" }];
  if (hint) line.push({ text: clip(hint, limit), tone: "accent" });
  return line;
};
