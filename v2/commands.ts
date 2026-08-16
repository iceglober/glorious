export type BuiltinAction = "help" | "skills" | "mcp" | "models" | "clear";

export type Command = {
  name: string;
  description: string;
  // A builtin drives the UI. A custom command has no action: its body is sent
  // as a turn, which is how a command defined in a markdown file — or a skill
  // that declares a trigger — reaches the model.
  run: BuiltinAction | null;
  body?: string;
  origin?: string;
};

const builtins: readonly Command[] = [
  { name: "help", description: "Show help and tips", run: "help" },
  { name: "clear", description: "Clear the conversation context", run: "clear" },
  { name: "skills", description: "List available skills", run: "skills" },
  { name: "mcp", description: "List active MCP servers", run: "mcp" },
  { name: "models", description: "Switch the active model", run: "models" },
];

// Loaded from disk after startup, so the table has to be readable as a function
// rather than frozen at import time.
let custom: readonly Command[] = [];

// A builtin always wins a name collision: a command file cannot capture /clear
// and quietly change what it does.
export const setCustomCommands = (loaded: readonly Command[]): void => {
  const taken = new Set(builtins.map((command) => command.name));
  custom = loaded.filter((command) => !taken.has(command.name));
};

export const commands = (): readonly Command[] => [...builtins, ...custom];

export const commandByName = (name: string): Command | undefined =>
  commands().find((command) => command.name === name.toLowerCase());

// $ARGUMENTS and $1..$9 follow the convention command files are already written
// against. A body with no placeholder still gets the arguments appended, or
// typing `/graphify some/path` would silently drop the path.
export const expandCommand = (body: string, args: string): string => {
  const trimmed = args.trim();
  const words = trimmed === "" ? [] : trimmed.split(/\s+/u);
  const placed = /\$ARGUMENTS|\$[1-9]/u.test(body);
  const filled = body
    .replaceAll("$ARGUMENTS", trimmed)
    .replace(/\$([1-9])/gu, (_, digit: string) => words[Number(digit) - 1] ?? "");
  if (placed || trimmed === "") return filled;
  // Appended rather than dropped, but marked: a bare `.` trailing 32kB of skill
  // instructions is indistinguishable from a stray character.
  return `${filled}\n\n<arguments>${trimmed}</arguments>`;
};

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

// Generic over the list so the composer can complete commands and extensions
// with one ranking, rather than two that drift apart.
export const matchNames = <T extends { name: string }>(items: readonly T[], query: string): T[] =>
  items
    .map((item, index) => ({ item, index, score: score(query, item.name) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, 6)
    .map((entry) => entry.item);

export const matchingCommands = (query: string): Command[] => matchNames(commands(), query);

// Which sigil the cursor is currently completing, if any. A sigil only counts
// at the start of a word, so `https://` and `$5 each` are prose rather than a
// half-typed command. When more than one is in play the latest one wins, since
// that is the one being typed.
export const activeSigil = (
  text: string,
  cursor: number,
  sigils: readonly string[],
): { sigil: string; start: number; query: string } | null => {
  const before = text.slice(0, cursor);
  let found: { sigil: string; start: number; query: string } | null = null;
  for (const sigil of sigils) {
    const start = before.lastIndexOf(sigil);
    if (start < 0 || (start > 0 && !/\s/u.test(text[start - 1]))) continue;
    if (found === null || start > found.start)
      found = { sigil, start, query: before.slice(start + sigil.length) };
  }
  return found;
};

export const commandName = (text: string): string | null => commandInvocation(text)?.name ?? null;

// Everything after the name travels with it; a custom command is useless
// without it, and an extension takes arguments the same way.
export const sigilInvocation = (
  text: string,
  sigil: string,
): { name: string; args: string } | null => {
  const match = new RegExp(`^\\s*\\${sigil}([a-z0-9-]+)(?:\\s+([\\s\\S]*))?$`, "iu").exec(
    text.trim(),
  );
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
};

export const commandInvocation = (text: string): { name: string; args: string } | null =>
  sigilInvocation(text, "/");

export const shortcutInvocation = (text: string): { name: string; args: string } | null =>
  sigilInvocation(text, "$");
