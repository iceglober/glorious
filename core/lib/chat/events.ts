import type { RunStep } from "../llm";

type ToolCall = RunStep["toolCalls"][number];
type ToolResult = RunStep["toolResults"][number];

/**
 * Everything the chat loop tells the outside world — the TUI renders these
 * and decides nothing.
 */
export type ChatEvent =
  | { type: "turn-started"; text: string; transcriptText?: string }
  | { type: "turn-queued"; text: string; transcriptText?: string; restoreText?: string }
  | { type: "turn-dequeued"; text: string; restoreText?: string }
  | { type: "tool-call"; call: ToolCall }
  | { type: "tool-result"; result: ToolResult }
  | { type: "turn-usage"; usage: NonNullable<RunStep["usage"]> }
  | { type: "assistant"; text: string; stepLimitReached?: boolean }
  | { type: "turn-abort-requested" }
  | { type: "turn-aborted" }
  | { type: "turn-error"; error: string }
  | { type: "turn-finished" }
  /** A submitted foreground turn has settled. */
  | { type: "submission-finished" }
  | { type: "notice"; text: string };
