/**
 * ToolExecutor — the boundary for behavior tool calls. Calls surface in the
 * log as tool.requested/tool.responded pairs; strict replay swaps this port
 * for a recorded one so tools are never re-executed during replay.
 */

import type { ToolError } from "../domain/effects";
import type { Result } from "../lib/fp";

export interface ToolExecutor {
  readonly execute: (name: string, input: unknown) => Promise<Result<unknown, ToolError>>;
}
