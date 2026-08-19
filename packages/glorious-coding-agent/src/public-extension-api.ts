/** @module Extension API
 *  @group Reference
 */

import type { Glorious } from "./extension-api";

export type {
  Activity,
  Capture,
  CommandSpec,
  Compaction,
  EventName,
  EventPayload,
  FlagSpec,
  Glorious,
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
export type Extension = (glorious: Glorious) => void | Promise<void>;
