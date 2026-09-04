/**
 * Build project or User extensions that run inside glrs.
 *
 * An extension default-exports a function receiving {@link Glrs}. The same API
 * works in the TUI and print mode; check {@link Glrs.hasUI} before capturing
 * interactive input.
 *
 * @example A one-file tool
 * ```ts
 * import type { Extension } from "@glrs-dev/glrs";
 *
 * const extension: Extension = (g) => {
 *   g.tool({
 *     name: "hello",
 *     description: "Greet someone by name.",
 *     input: g.z.object({ name: g.z.string() }),
 *     execute: ({ name }) => `hello ${name}`,
 *   });
 * };
 *
 * export default extension;
 * ```
 *
 * @module Extension API
 * @group API
 */

import type { Glrs } from "./extension-api";

export type {
  Activity,
  AutocompleteProvider,
  Capture,
  CommandSpec,
  Compaction,
  EntryRenderer,
  EventName,
  EventPayload,
  ExtensionChoice,
  ExtensionProvider,
  FlagSpec,
  Glrs,
  Handler,
  HandlerVerdict,
  Key,
  KeySpec,
  Line,
  Loaded,
  MessageRenderer,
  ModelInfo,
  MountSpec,
  SessionInfo,
  ShellResult,
  Span,
  SurfacePlacement,
  Tone,
  ToolSpec,
  Ui,
  Usage,
  Verdict,
} from "./extension-api";
export type { FirstPartyExtension } from "./extensions";
export type { WriteOutcome } from "./index";
export type { SkillSummary } from "./skills";

/**
 * A deployable extension module.
 *
 * Initialization is awaited before the first turn. Throwing prevents only this
 * extension from loading; other extensions and the session continue.
 */
export type Extension = (glrs: Glrs) => void | Promise<void>;
