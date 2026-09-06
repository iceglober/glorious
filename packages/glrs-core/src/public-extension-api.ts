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
 * ## stability
 *
 * From 1.0.0 every member here is covered by semver: a break is a major.
 * Members marked `@beta` are the exception and may change in a minor.
 *
 * A field added to a type an extension can construct is declared optional, so
 * that learning something new about a model or a session is an addition rather
 * than a break. `ModelInfo.missing` is the worked example: it arrived required,
 * broke the model picker, and is optional now.
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
