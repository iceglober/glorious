/** @module Extension API
 *  @group Reference
 */

import type { Glrs } from "./extension-api";

export type {
  Activity,
  Capture,
  CommandSpec,
  Compaction,
  EventName,
  EventPayload,
  FlagSpec,
  Glrs,
  Handler,
  HandlerVerdict,
  Key,
  KeySpec,
  Line,
  Loaded,
  ModelInfo,
  SessionInfo,
  ShellResult,
  Span,
  Tone,
  ToolSpec,
  Ui,
  Usage,
  Verdict,
} from "./extension-api";
export type { SkillSummary } from "./skills";

/** A deployable extension module. */
export type Extension = (glrs: Glrs) => void | Promise<void>;
