export type Command = {
  name: string;
  description: string;
  // null means the body is the prompt: a markdown command file, or a skill that
  // declares a trigger. An extension's command has a runner instead, held by
  // the registry rather than here.
  run: null;
  body?: string;
  origin?: string;
};

// The core registers no commands of its own. /help, /clear, /skills,
// /extensions and /reload are a bundled extension, written against the same API
// a third party gets — which is the only way "extensible" is a fact rather than
// a claim. Nothing here treats them specially, so any of them can be shadowed
// or dropped.
let custom: readonly Command[] = [];

export const setCustomCommands = (loaded: readonly Command[]): void => {
  const seen = new Set<string>();
  custom = loaded.filter((command) => !seen.has(command.name) && seen.add(command.name));
};

export const commands = (): readonly Command[] => custom;

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

// Every match, ranked. Generic over the list so the composer completes
// commands, sequences and files with one ranking rather than three that drift.
//
// It used to cut to six here. The composer draws a scrolling window over
// whatever it is given, so cutting first meant the other thirty-one commands
// did not exist: scrolling could not reach them, and the "n more" line — which
// counts what the window is not showing — had nothing to count. Ranking says
// what is likeliest; how much fits on screen is the composer's business.
const MATCH_LIMIT = 200;

export const matchNames = <T extends { name: string }>(items: readonly T[], query: string): T[] =>
  items
    .map((item, index) => ({ item, index, score: score(query, item.name) }))
    .filter((entry): entry is { item: T; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, MATCH_LIMIT)
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
// without it, and a sequence takes arguments the same way.
export const sigilInvocation = (
  text: string,
  sigil: string,
): { name: string; args: string } | null => {
  // `:` is legal in a name so skills can live under their own `skill:` prefix.
  // Without it `/skill:graphify` parsed as nothing at all and fell through to
  // "unknown command".
  const match = new RegExp(`^\\s*\\${sigil}([a-z0-9:-]+)(?:\\s+([\\s\\S]*))?$`, "iu").exec(
    text.trim(),
  );
  if (!match) return null;
  return { name: match[1].toLowerCase(), args: (match[2] ?? "").trim() };
};

export const commandInvocation = (text: string): { name: string; args: string } | null =>
  sigilInvocation(text, "/");

export const shortcutInvocation = (text: string): { name: string; args: string } | null =>
  sigilInvocation(text, "$");
