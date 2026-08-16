import { readdir } from "node:fs/promises";
import { basename, join } from "node:path";
import { agentDirectories, scalar } from "./usercommands";

// A sequence is the named form of `!`, and the zero-code way to extend
// glorious: shell runs, its stdout becomes evidence in a prompt, and the
// conversation optionally clears first — in that order, which is the name.
// A slash command always ends in a turn; shell mode never does but has to be
// typed out in full. A sequence is a command the project names and glorious
// runs, and whether the model hears about it is the file's decision, not the
// mechanism's. When a markdown file is not enough, write an extension.
export type Sequence = {
  name: string;
  description: string;
  // the shell that runs, always
  run: string;
  // the prompt sent once the shell succeeds. Empty means this sequence is a
  // pure side effect and no turn is produced at all.
  body: string;
  // drop the conversation once the shell succeeds
  clear: boolean;
  origin: string;
};

// `extensions/` is where these lived before .ts extensions took the name. Kept
// for one release so an upgrade does not silently drop a project's shortcuts;
// loadSequences reports what it found there so the notice can name the move.
const LEGACY_LEAF = "extensions";

const sequenceRoots = (root: string, leaf = "sequences"): string[] =>
  agentDirectories(root).map((directory) => join(directory, leaf));

// A frontmatter value written as an indented block under its key rather than on
// it. Same shape skills.ts already accepts for mcpServers, so a multi-line
// `run:` needs no YAML parser — there is none at runtime.
const blockAt = (lines: readonly string[], start: number): { text: string; next: number } => {
  const body: string[] = [];
  let index = start;
  while (index < lines.length) {
    const line = lines[index];
    if (line.trim() !== "" && !/^\s/u.test(line)) break;
    body.push(line);
    index += 1;
  }
  while (body.length > 0 && body[body.length - 1].trim() === "") body.pop();
  const widths = body
    .filter((line) => line.trim() !== "")
    .map((line) => /^\s*/u.exec(line)?.[0].length ?? 0);
  const strip = widths.length === 0 ? 0 : Math.min(...widths);
  return {
    text: body
      .map((line) => line.slice(strip))
      .join("\n")
      .trimEnd(),
    next: index,
  };
};

export const parseSequence = (name: string, text: string, origin = ""): Sequence | null => {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end < 0) return null;
  let description = "";
  let run = "";
  let clear = false;
  let index = 1;
  while (index < end) {
    const match = /^(description|run|clear):\s*(.*)$/u.exec(lines[index]);
    if (!match) {
      index += 1;
      continue;
    }
    const [, key, rest] = match;
    // `run: |` and a bare `run:` both mean the value is the block beneath it.
    // Anything else on the line is the value.
    if (key === "run" && (rest.trim() === "" || rest.trim() === "|" || rest.trim() === "|-")) {
      const block = blockAt(lines.slice(0, end), index + 1);
      run = block.text;
      index = block.next;
      continue;
    }
    if (key === "run") run = scalar(rest);
    else if (key === "description") description = scalar(rest);
    else clear = scalar(rest) === "true";
    index += 1;
  }
  // Without a command there is nothing deterministic to do, which is the only
  // thing a sequence is for. A prompt on its own is a slash command.
  if (run.trim() === "") return null;
  return {
    name,
    description: description || `Run the ${name} sequence`,
    run,
    body: lines
      .slice(end + 1)
      .join("\n")
      .trim(),
    clear,
    origin,
  };
};

const readSequences = async (directory: string): Promise<Sequence[]> => {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const found: Sequence[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const path = join(directory, entry.name);
    const text = await Bun.file(path)
      .text()
      .catch(() => "");
    if (text.trim() === "") continue;
    const parsed = parseSequence(basename(entry.name, ".md").toLowerCase(), text, path);
    if (parsed) found.push(parsed);
  }
  return found;
};

// The first directory to define a name wins, so a project sequence shadows a
// personal one rather than both appearing — the same rule commands follow.
// `sequences/` beats `extensions/` for the same reason: during the one release
// both are read, a project that has moved is not shadowed by what it left.
export const loadSequences = async (
  root: string,
): Promise<{ sequences: Sequence[]; legacy: string[] }> => {
  const seen = new Map<string, Sequence>();
  const legacy: string[] = [];
  for (const leaf of ["sequences", LEGACY_LEAF])
    for (const directory of sequenceRoots(root, leaf))
      for (const sequence of await readSequences(directory)) {
        if (seen.has(sequence.name)) continue;
        seen.set(sequence.name, sequence);
        if (leaf === LEGACY_LEAF) legacy.push(sequence.origin);
      }
  return { sequences: [...seen.values()], legacy };
};
