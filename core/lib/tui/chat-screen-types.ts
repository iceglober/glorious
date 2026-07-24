import type { PermissionPromptDecision, PermissionRequest } from "../agent/permissions";
import type { GuidedInputOptions, GuidedInputPort } from "../chat/guided-input";
import type { UiBlock, UiTextLine } from "./styles";

/**
 * The chat surface contract shared by the composition root and the screen. The
 * screen renders and routes keys; it decides nothing (ChatSession does).
 */

export interface ChatScreenCallbacks {
  onSubmit(text: string): void;
  onTab(): void;
  /** Reads copied attachments and returns an editor marker ready for insertion. */
  onPasteFiles?(): Promise<string | null>;
  onEscape(): void;
  /** Double Ctrl+C on an empty editor. */
  onQuit(): void;
}

export interface ChatScreen extends GuidedInputPort {
  start(): void;
  stop(): void;
  /** Append sanitized plain or semantic transcript output above the live region. */
  printAbove(text: string | UiBlock, spacing?: "none" | "turn"): void;
  /** Clear all rendered transcript output and repaint the live editor. */
  clearTranscript(): void;
  /** Restore a dequeued prompt, ahead of any draft already being edited. */
  restoreInput(text: string): void;
  /** Replace the progress block (empty array hides it). */
  setProgressLines(lines: UiTextLine[]): void;
  /** Set the visible composer identity and empty-state guidance. */
  setComposer(options: { label: string; placeholder: string }): void;
  /** Replace the status section below the editor (idle repaints are skipped). */
  setStatusLines(lines: UiTextLine[]): void;
  /** Usable line width (columns minus the repaint-safety margin) for
   *  width-aware status composition — lines this long survive safeLine. */
  width(): number;
  /** Modal single-key permission prompt in the live region. */
  askPermission(request: PermissionRequest): Promise<PermissionPromptDecision>;
  /** Modal editor prompt. Escape cancels without submitting or retaining the value. */
  askInput(options: GuidedInputOptions): Promise<string | null>;
  /** Lend the renderer to a full-screen sub-screen (e.g. the `/config` TUI),
   *  restoring the chat when it finishes. */
  runModalScreen(
    run: (renderer: import("@opentui/core").CliRenderer) => Promise<void>,
  ): Promise<void>;
}
