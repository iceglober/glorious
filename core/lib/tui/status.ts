import { splitGraphemes } from "./editor";
import { displayWidth, graphemeWidth, truncateToDisplayWidth } from "./terminal-editor";

const VU_BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

/** An ambient "working" meter: a bank of block bars that bob like an audio VU
 *  meter. Deterministic in `frame` so the 250ms status ticker animates it, and
 *  so it stays testable. Each bar rides a sine wave offset from its neighbours,
 *  giving a continuous hum rather than a rotating spinner. */
export const formatVuMeter = (frame: number, bars = 5): string => {
  let out = "";
  for (let index = 0; index < bars; index += 1) {
    const level = Math.sin(frame * 0.55 + index * 1.1) * 0.5 + 0.5;
    out += VU_BLOCKS[Math.min(VU_BLOCKS.length - 1, Math.floor(level * VU_BLOCKS.length))];
  }
  return out;
};

export const formatClock = (ms: number): string => {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days}d${hours}h${minutes}m`;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
};

/** 456 → "456", 2437 → "2.4k", 1_952_300 → "2.0m". */
const formatStatusTokens = (count: number): string => {
  if (count < 1000) return `${count}`;
  if (count < 1_000_000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1_000_000).toFixed(1)}m`;
};

const normalizedWidth = (width: number): number => Math.max(0, Math.floor(width));

/** Long paths keep their head and leaf: ~/repos/…/nested/repo. */
const middleEllipsis = (text: string, maxWidth: number): string => {
  const width = normalizedWidth(maxWidth);
  if (displayWidth(text) <= width) return text;
  if (width === 0) return "";
  if (width === 1) return "…";

  const graphemes = splitGraphemes(text);
  const available = width - 1;
  const headBudget = Math.max(1, Math.floor(available * 0.4));
  let head = "";
  let headWidth = 0;
  let index = 0;
  while (index < graphemes.length) {
    const grapheme = graphemes[index] ?? "";
    const nextWidth = headWidth + graphemeWidth(grapheme);
    if (nextWidth > headBudget) break;
    head += grapheme;
    headWidth = nextWidth;
    index += 1;
  }

  let tail = "";
  let tailWidth = 0;
  for (let tailIndex = graphemes.length - 1; tailIndex >= index; tailIndex -= 1) {
    const grapheme = graphemes[tailIndex] ?? "";
    const nextWidth = headWidth + tailWidth + graphemeWidth(grapheme);
    if (nextWidth > available) break;
    tail = `${grapheme}${tail}`;
    tailWidth += graphemeWidth(grapheme);
  }
  return `${head}…${tail}`;
};

export interface StatusSectionState {
  /** Display path of the directory the session started in. */
  root: string;
  /** Model label, e.g. "gpt-5.6-luna". */
  model: string;
  /** Latest request's context size. */
  usage: { ctx: number };
  /** When set, ctx displays against this soft limit (for example, 8.7k/8.0k). */
  contextSoftLimit?: number;
}

export const composeStatusSection = (
  state: StatusSectionState,
  requestedWidth: number,
): string[] => {
  const width = normalizedWidth(requestedWidth);
  const context =
    state.contextSoftLimit === undefined
      ? formatStatusTokens(state.usage.ctx)
      : `${formatStatusTokens(state.usage.ctx)}/${formatStatusTokens(state.contextSoftLimit)}`;
  const fullContext = `${state.model} · ctx ${context}`;
  const compactContext = `ctx ${context}`;
  // The info line degrades location → model → context.
  const rootWidth = width - displayWidth(fullContext) - 3;
  const info =
    rootWidth >= 8
      ? `${middleEllipsis(state.root, rootWidth)} · ${fullContext}`
      : displayWidth(fullContext) <= width
        ? fullContext
        : compactContext;
  return [truncateToDisplayWidth(info, width)];
};
