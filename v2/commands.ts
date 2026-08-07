export type Command = {
  name: string;
  description: string;
  run: "help" | "skills" | "tools";
};

export const commands: readonly Command[] = [
  { name: "help", description: "Show help and tips", run: "help" },
  { name: "skills", description: "List available skills", run: "skills" },
  { name: "tools", description: "List available tools", run: "tools" },
];

const score = (query: string, candidate: string): number | null => {
  if (query === "") return 0;
  let at = 0;
  let total = 0;
  for (const char of query.toLowerCase()) {
    const found = candidate.indexOf(char, at);
    if (found < 0) return null;
    total += found === at ? 3 : 1;
    at = found + 1;
  }
  return total - candidate.length / 100;
};

export const matchingCommands = (query: string): Command[] =>
  commands
    .map((command, index) => ({ command, index, score: score(query, command.name) }))
    .filter(
      (entry): entry is { command: Command; index: number; score: number } => entry.score !== null,
    )
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 6)
    .map((entry) => entry.command);

export const activeSlash = (
  text: string,
  cursor: number,
): { start: number; query: string } | null => {
  const before = text.slice(0, cursor);
  const start = before.lastIndexOf("/");
  if (start < 0 || (start > 0 && !/\s/u.test(text[start - 1]))) return null;
  return { start, query: before.slice(start + 1) };
};

export const commandName = (text: string): string | null => {
  const match = /^\s*\/([a-z0-9-]+)(?:\s|$)/iu.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
};
