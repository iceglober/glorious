/**
 * What the run did to the working tree.
 *
 * The first question after handing a shell to a model is "what did it change?"
 * — and command output does not answer it: a command that writes a file
 * usually prints nothing. Both the before and after states are ordinary
 * `workspace.sampled` values, so the answer is a diff of two records the log
 * already holds, not new instrumentation.
 */

import type { Workspace } from "./coding-agent";

/** The path part of a porcelain status line: `" M src/app.ts"` → `src/app.ts`. */
const pathOf = (line: string): string => line.slice(3);

const added = (before: readonly string[], after: readonly string[]): readonly string[] => {
  const seen = new Set(before);
  return after.filter((value) => !seen.has(value));
};

export interface WorkspaceChanges {
  readonly createdEntries: readonly string[];
  readonly removedEntries: readonly string[];
  /** Porcelain lines present after the run that were not present before. */
  readonly newlyDirty: readonly string[];
}

export const workspaceChanges = (before: Workspace, after: Workspace): WorkspaceChanges => ({
  createdEntries: added(before.entries, after.entries),
  removedEntries: added(after.entries, before.entries),
  newlyDirty: added(before.dirty ?? [], after.dirty ?? []),
});

/** A human line per kind of change, or null when the tree is untouched. */
export const describeChanges = (before: Workspace, after: Workspace): string | null => {
  const changes = workspaceChanges(before, after);
  // A file that was already dirty and is now dirty differently shows up as a
  // new porcelain line, so listing paths would repeat what the line says.
  const lines = [
    changes.createdEntries.length === 0 ? "" : `created: ${changes.createdEntries.join(", ")}`,
    changes.removedEntries.length === 0 ? "" : `removed: ${changes.removedEntries.join(", ")}`,
    changes.newlyDirty.length === 0
      ? ""
      : `uncommitted: ${changes.newlyDirty.map(pathOf).join(", ")}`,
  ].filter((line) => line !== "");
  return lines.length === 0 ? null : lines.join("\n  ");
};
