import { readdir } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { fence } from "./prompt";

// `@path` in a message means "and here is that file". The path stays in the
// text the transcript shows — it is what you typed — and the contents ride
// along fenced, so a file reads as material rather than as further
// instructions. The alternative is pasting a path and hoping the agent reads
// it, which costs a turn and sometimes the wrong file.

const MENTION = /(?:^|\s)@([^\s@]+)/gu;
const FILE_LIMIT = 100_000;
const MAX_FILES = 10;

export const mentioned = (text: string): string[] => [
  ...new Set([...text.matchAll(MENTION)].map((match) => match[1].replace(/[.,;:)]+$/u, ""))),
];

// Confined to the project, like every other path glorious resolves. A mention
// that escapes is left as written: it is then just text, which is what someone
// typing an email address gets.
const within = (root: string, target: string): string | null => {
  const full = resolve(root, target);
  return full === root || full.startsWith(`${root}${sep}`) ? full : null;
};

export const expandMentions = async (
  root: string,
  text: string,
): Promise<{ prompt: string; attached: string[]; missing: string[] }> => {
  const attached: string[] = [];
  const missing: string[] = [];
  const blocks: string[] = [];
  for (const path of mentioned(text).slice(0, MAX_FILES)) {
    const full = within(resolve(root), path);
    if (full === null) continue;
    const file = Bun.file(full);
    if (!(await file.exists())) {
      missing.push(path);
      continue;
    }
    const body = await file.text().catch(() => null);
    if (body === null) {
      missing.push(path);
      continue;
    }
    attached.push(path);
    blocks.push(
      `<file path="${path}">\n${body.length > FILE_LIMIT ? `${body.slice(0, FILE_LIMIT)}\n[truncated]` : body}\n</file>`,
    );
  }
  return {
    prompt:
      blocks.length === 0 ? text : `${text}\n\n${fence("mentioned-files", blocks.join("\n\n"))}`,
    attached,
    missing,
  };
};

// Candidates for the composer's `@` completion. Ranked the way the file picker
// in an editor is: shallow before deep, then alphabetical, so the file you meant
// is usually the first one.
const SKIP = new Set([".git", "node_modules", "dist", "build", ".next", "coverage", ".turbo"]);

export const fileCandidates = async (root: string, query: string, cap = 8): Promise<string[]> => {
  const wanted = query.toLowerCase();
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 6 || found.length > 400) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".glorious") continue;
      if (SKIP.has(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else found.push(relative(root, full));
    }
  };
  await walk(root, 0);
  return found
    .filter((path) => path.toLowerCase().includes(wanted))
    .sort((a, b) => a.split(sep).length - b.split(sep).length || a.localeCompare(b))
    .slice(0, cap);
};
