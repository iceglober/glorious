import type { ChatEvent } from "../chat/events";
import { truncateWithNotice } from "../truncation";
import { renderMarkdownLite } from "./markdown";
import { formatDuration } from "./progress";
import type { UiBlock, UiLine, UiSpan, UiTone } from "./styles";
import { formatUserTurnBlock } from "./transcript";

/**
 * One rendering seam for the chat transcript. A `ChatEvent` becomes a typed
 * `TranscriptItem` (via {@link toTranscriptItem}), and a single switch
 * ({@link renderTranscriptItem}) lowers each kind to the shared `UiBlock`
 * model both live-region adapters already print. Tone carries meaning here —
 * an outcome glyph, a status color — instead of coloring whole rows.
 */

const STEP_LIMIT_NOTICE = '(step limit reached — turn stopped mid-work; send "continue" to resume)';
const EMPTY_RESPONSE_NOTICE = "(no response — the model returned nothing; try again)";

/** Outcome tone for a tool row. `running` is the live-region spinner state. */
export type ToolOutcome = "running" | "ok" | "fail" | "blocked";

/** One finished (or running) tool call, ready to render in either place. */
export interface ToolRow {
  tool: string;
  detail: string;
  elapsedMs?: number;
  outcome: ToolOutcome;
}

export interface UserTurnItem {
  kind: "user";
  text: string;
  transcriptText?: string;
}

export interface AssistantItem {
  kind: "assistant";
  body: string;
  stepLimitReached?: boolean;
}

export interface ToolItem {
  kind: "tool";
  row: ToolRow;
}

/** System-ish one-liners. `tone` colors a failed/notable line when known. */
export interface NoticeItem {
  kind: "notice" | "dequeued";
  text: string;
  tone?: UiTone;
}

export interface ErrorItem {
  kind: "error";
  text: string;
  /** Optional muted follow-up (e.g. the content-filter guidance). */
  hint?: string;
}

export interface EmptyResponseItem {
  kind: "empty";
}

export type TranscriptItem =
  | UserTurnItem
  | AssistantItem
  | ToolItem
  | NoticeItem
  | ErrorItem
  | EmptyResponseItem;

export type RenderedItem = { block: UiBlock; spacing: "none" | "turn" };

const OUTCOME: Record<ToolOutcome, { glyph: string; tone: UiTone }> = {
  running: { glyph: "▌", tone: "accent" },
  ok: { glyph: "✓", tone: "success" },
  fail: { glyph: "✗", tone: "danger" },
  blocked: { glyph: "⊘", tone: "warning" },
};

const flatten = (value: string): string => value.replace(/\r\n?|\n/gu, " ");

/**
 * Anchor a model response with a leading marker on its first line, the way user
 * turns lead with `❯` and tool rows with `✓` — so the assistant's prose reads as
 * a distinct block, not loose text between the activity rows.
 */
const ASSISTANT_MARKER: UiSpan = { text: "● ", tone: "accent" };
const anchorAssistant = (block: UiBlock): UiBlock => {
  const [first, ...rest] = block;
  return [[ASSISTANT_MARKER, ...(first ?? [])], ...rest];
};

/**
 * The shared tool-row shape. `live:true` is the running spinner form for the
 * progress region; `live:false` freezes it into the transcript. Only the
 * leading glyph carries tone — the tool name is default weight and the detail
 * and duration are muted — so a busy turn reads as a calm column, not a wall
 * of color.
 */
export const renderToolRow = (row: ToolRow, opts: { live: boolean }, width: number): UiBlock => {
  const { glyph, tone } = OUTCOME[opts.live ? "running" : row.outcome];
  const spans: UiSpan[] = [
    { text: "  " },
    { text: glyph, tone },
    { text: " " },
    { text: row.tool },
  ];
  if (row.detail.trim().length > 0) {
    spans.push({
      text: `  ${truncateWithNotice(flatten(row.detail), Math.max(1, width))}`,
      tone: "muted",
    });
  }
  if (row.elapsedMs !== undefined) {
    spans.push({ text: `  ${formatDuration(row.elapsedMs)}`, tone: "muted" });
  }
  return [spans];
};

/** Map a `ChatEvent` to the transcript item it renders as, or null to skip it. */
export const toTranscriptItem = (event: ChatEvent): TranscriptItem | null => {
  switch (event.type) {
    case "turn-started":
      return {
        kind: "user",
        text: event.text,
        ...(event.transcriptText !== undefined ? { transcriptText: event.transcriptText } : {}),
      };
    case "assistant": {
      const body = event.text.trim();
      if (body.length === 0 && !event.stepLimitReached) return { kind: "empty" };
      return {
        kind: "assistant",
        body,
        ...(event.stepLimitReached ? { stepLimitReached: true } : {}),
      };
    }
    case "turn-error": {
      const filtered = /content management policy|content filter|was filtered/iu.test(event.error);
      return {
        kind: "error",
        text: `error: ${event.error}`,
        ...(filtered
          ? {
              hint: "The provider's content filter rejected this request. It often fires intermittently — retry once; if it keeps happening, start a new session (glorious) instead.",
            }
          : {}),
      };
    }
    case "turn-aborted":
      return { kind: "notice", text: "(turn interrupted)" };
    case "turn-dequeued":
      return {
        kind: "dequeued",
        text: `(dequeued) ${(event.restoreText ?? event.text).split("\n")[0]?.slice(0, 60) ?? ""}`,
      };
    case "notice":
      return { kind: "notice", text: event.text };
    default:
      return null;
  }
};

/** The single switch that lowers a `TranscriptItem` to a block plus spacing. */
export const renderTranscriptItem = (item: TranscriptItem, width: number): RenderedItem => {
  switch (item.kind) {
    case "user":
      return {
        block: formatUserTurnBlock(item.text, item.transcriptText, width),
        spacing: "turn",
      };
    case "assistant": {
      const text = item.stepLimitReached
        ? `${item.body.length > 0 ? `${item.body}\n` : ""}${STEP_LIMIT_NOTICE}`
        : item.body;
      return { block: anchorAssistant(renderMarkdownLite(text)), spacing: "turn" };
    }
    case "empty":
      return { block: [[{ text: EMPTY_RESPONSE_NOTICE, tone: "muted" }]], spacing: "turn" };
    case "tool":
      return { block: renderToolRow(item.row, { live: false }, width), spacing: "none" };
    case "error": {
      const block: UiLine[] = [[{ text: item.text, tone: "danger" }]];
      if (item.hint) block.push([{ text: item.hint, tone: "muted" }]);
      return { block, spacing: "none" };
    }
    default: {
      const tone = item.tone;
      const block: UiBlock = item.text
        .split("\n")
        .map((line): UiLine => (tone ? [{ text: line, tone }] : [{ text: line }]));
      return { block, spacing: "none" };
    }
  }
};
