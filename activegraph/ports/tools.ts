/**
 * ToolExecutor — the boundary for behavior tool calls. Calls surface in the
 * log as tool.requested/tool.responded pairs; strict replay swaps this port
 * for a recorded one so tools are never re-executed during replay.
 */
import type { Result } from "../lib/fp";
import type { ToolError } from "../domain/effects";

export interface ToolExecutor {
  readonly execute: (name: string, input: unknown) => Promise<Result<unknown, ToolError>>;
}
