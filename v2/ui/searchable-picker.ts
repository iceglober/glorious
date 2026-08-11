import type { KeyEvent, TextRenderable } from "@opentui/core";
import type { Chrome, Host } from "./chrome";

export type SearchableOption<T> = {
  name: string;
  description?: string;
  fields: readonly string[];
  value: T;
};

export const searchScore = (query: string, fields: readonly string[]): number | null => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return 0;
  let best: number | null = null;
  for (const field of fields) {
    const value = field.toLowerCase();
    const exact = value === needle ? 1000 : null;
    const prefix = value.startsWith(needle) ? 700 - value.length : null;
    const included = value.includes(needle) ? 500 - value.length : null;
    let at = 0;
    let consecutive = 0;
    let score = 0;
    for (const char of needle) {
      const found = value.indexOf(char, at);
      if (found < 0) {
        score = -1;
        break;
      }
      score += found === at ? 12 : 2;
      if (found === at) consecutive += 1;
      at = found + 1;
    }
    const subsequence = score < 0 ? null : 100 + score + consecutive * 4 - value.length / 100;
    const candidate = Math.max(
      exact ?? -Infinity,
      prefix ?? -Infinity,
      included ?? -Infinity,
      subsequence ?? -Infinity,
    );
    if (candidate !== -Infinity && (best === null || candidate > best)) best = candidate;
  }
  return best;
};

export type SearchablePicker = {
  picker: InstanceType<Chrome["tui"]["SelectRenderable"]>;
  header: TextRenderable;
  handleKey: (event: KeyEvent) => boolean;
};

export const createSearchablePicker = <T>(options: {
  chrome: Chrome;
  host: Host;
  items: readonly SearchableOption<T>[];
  height: number;
  placeholder: string;
}): SearchablePicker => {
  const { chrome, host, items, height, placeholder } = options;
  const { tui, renderer, textNode, styled } = chrome;
  let query = "";
  const header = textNode({ content: "", width: "100%", height: 1 });
  const picker = new tui.SelectRenderable(renderer, {
    width: "100%",
    height,
    showScrollIndicator: true,
    options: [],
  });
  const render = (): void => {
    picker.options = items
      .map((item, index) => ({ item, index, score: searchScore(query, item.fields) }))
      .filter(
        (entry): entry is { item: SearchableOption<T>; index: number; score: number } =>
          entry.score !== null,
      )
      .sort((a, b) => b.score - a.score || a.index - b.index)
      .map(({ item }) => ({
        name: item.name,
        description: item.description ?? "",
        value: item.value,
      }));
    picker.selectedIndex = 0;
    header.content = styled([
      [{ text: query === "" ? placeholder : `Search: ${query}`, tone: "accent" }],
    ]);
    host.draw();
  };
  render();

  return {
    picker,
    header,
    handleKey: (event): boolean => {
      if (event.ctrl || event.meta || event.option) return false;
      if (event.name === "backspace") query = query.slice(0, -1);
      else if (event.sequence.length === 1 && event.name.length === 1) query += event.sequence;
      else return false;
      event.stopPropagation();
      render();
      return true;
    },
  };
};
