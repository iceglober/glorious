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

// Which slice of the completion list is on screen, and what is off the ends of
// it. The list used to paint every match and grow the panel to fit, which was
// only survivable because the file search capped itself at eight — so a query
// with sixty matches showed eight and gave no sign the rest existed.
export const completionWindow = (
  total: number,
  index: number,
  rows: number,
): { first: number; count: number; above: number; below: number } => {
  const count = Math.max(0, Math.min(total, rows));
  // Scrolled to keep the selection inside the window, and clamped so the last
  // page is a full page rather than a window hanging off the end.
  const first = Math.max(0, Math.min(index - count + 1, total - count));
  return { first, count, above: first, below: Math.max(0, total - first - count) };
};
