import type { UiBlock, UiTextLine } from "./styles";

/**
 * The chat surface contract shared by the composition root and the screen. The
 * screen renders and routes keys; it decides nothing (ChatSession does).
 */

export interface ChatScreenCallbacks {
  onSubmit(text: string): void;
  onEscape(): void;
  /** Double Ctrl+C on an empty editor. */
  onQuit(): void;
}

export interface ChatScreen {
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
}
