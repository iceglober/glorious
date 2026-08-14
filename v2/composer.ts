const enterKeys = new Set(["return", "kpenter", "linefeed"]);

export const composerWrapMode = "word" as const;

export const composerKeyBindings = <T extends { name: string; shift?: boolean }>(
  bindings: readonly T[],
): T[] =>
  bindings.filter(
    (binding) =>
      binding.shift ||
      (!enterKeys.has(binding.name) && binding.name !== "up" && binding.name !== "down"),
  );

// Whether an arrow key should reach for history or move inside the draft. These
// count logical lines, so a soft-wrapped paragraph is one line: pressing up from
// inside a long unbroken line reaches history rather than the row above it.
export const atFirstLine = (text: string, cursor: number): boolean =>
  !text.slice(0, Math.max(0, cursor)).includes("\n");

export const atLastLine = (text: string, cursor: number): boolean =>
  !text.slice(Math.max(0, cursor)).includes("\n");
