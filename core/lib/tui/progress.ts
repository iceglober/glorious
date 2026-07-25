import { truncateWithNotice } from "../truncation";

/**
 * Live tool-activity rendering: feed activity state in, get the current block
 * of display lines out. Pure state — the chat screen owns painting and the
 * spinner cadence.
 */

/**
 * The running-tool sweep: a short bar that grows from the left to full, then
 * empties from the left (sliding the fill to the right), then grows from the
 * right and empties from the right — a side-to-side wipe rather than a single
 * cell growing and shrinking in place. Never fully empty, so it never blinks.
 */
const TOOL_SWEEP = [
  "█    ",
  "██   ",
  "███  ",
  "████ ",
  "█████",
  " ████",
  "  ███",
  "   ██",
  "    █",
  "   ██",
  "  ███",
  " ████",
  "█████",
  "████ ",
  "███  ",
  "██   ",
];
export const formatToolSweep = (frame: number): string =>
  TOOL_SWEEP[((frame % TOOL_SWEEP.length) + TOOL_SWEEP.length) % TOOL_SWEEP.length] ?? "█████";

const truncateLine = (value: string, maxLength: number): string =>
  truncateWithNotice(value.replace(/\r\n?|\n/gu, " "), maxLength);

/** A bounded, single-line tool label shared by live and completed activity rows. */
export const formatToolActivityLabel = (
  tool: string,
  detail: string,
  maxDetailLength = 120,
): string => `${tool}${detail ? ` ${truncateLine(detail, maxDetailLength)}` : ""}`;

/** 340 → "340ms", 2140 → "2.1s", 74_200 → "74.2s". */
export const formatDuration = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;

export const TOOL_ACTIVITY_VISIBILITY_DELAY_MS = 250;

export interface ActiveToolActivity {
  tool: string;
  detail: string;
  /** Optional for callers that do not need delayed live visibility. */
  startedAt?: number;
}

export const isToolActivityVisible = (activity: ActiveToolActivity, now = Date.now()): boolean =>
  activity.startedAt === undefined || now - activity.startedAt >= TOOL_ACTIVITY_VISIBILITY_DELAY_MS;

export const countVisibleToolActivities = (
  activeTools: Iterable<ActiveToolActivity | readonly [number, ActiveToolActivity]>,
  now = Date.now(),
): number =>
  [...activeTools].filter((entry) => {
    const activity = Array.isArray(entry) ? entry[1] : entry;
    return isToolActivityVisible(activity, now);
  }).length;

export const composeProgressLines = (state: {
  activeTools: Iterable<[number, ActiveToolActivity]>;
  queued: string[];
  /** Animation frame for the running-tool sweep (advances on the fast tick). */
  frame: number;
  now?: number;
}): string[] => {
  const sweep = formatToolSweep(state.frame);
  const now = state.now ?? Date.now();
  const toolRows: string[] = [];
  for (const [, activity] of state.activeTools) {
    if (!isToolActivityVisible(activity, now)) continue;
    const { tool, detail } = activity;
    toolRows.push(`  ${sweep} ${formatToolActivityLabel(tool, detail, 80)}`);
  }
  return [...toolRows, ...state.queued];
};
