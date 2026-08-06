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
