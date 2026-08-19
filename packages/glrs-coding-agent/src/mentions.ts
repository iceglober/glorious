import { readdir, stat } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { fence } from "./prompt";

// `@path` in a message means "and here is that file". The path stays in the
// text the transcript shows — it is what you typed — and the contents ride
// along fenced, so a file reads as material rather than as further
// instructions. The alternative is pasting a path and hoping the agent reads
// it, which costs a turn and sometimes the wrong file.

const SKIP = [".git", "node_modules", "dist", "build", ".next", "coverage", ".turbo"];

// ripgrep skips these only when .gitignore says to, and plenty of trees are not
// git repositories. Excluding them outright keeps the guarantee the hand-walk
// had, on top of whatever .gitignore adds.
const EXCLUDES = SKIP.flatMap((name) => ["--glob", `!${name}`]);

const MENTION = /(?:^|\s)@([^\s@]+)/gu;
const FILE_LIMIT = 100_000;
const MAX_FILES = 10;

export const mentioned = (text: string): string[] => [
  ...new Set([...text.matchAll(MENTION)].map((match) => match[1].replace(/[.,;:)]+$/u, ""))),
];

// Confined to the project, like every other path glrs resolves. A mention
// that escapes is left as written: it is then just text, which is what someone
// typing an email address gets.
const within = (root: string, target: string): string | null => {
  const full = resolve(root, target);
  return full === root || full.startsWith(`${root}${sep}`) ? full : null;
};

// What a mentioned directory carries: the paths under it, not their contents.
// Attaching every file under `@src` would blow the context on one keystroke;
// the listing is what lets the model choose which of them to read.
const DIR_ENTRIES = 200;

const directoryListing = async (root: string, full: string): Promise<string | null> => {
  const run = Bun.spawn([rgPath, "--files", ...EXCLUDES], {
    cwd: full,
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(run.stdout).text().catch(() => "");
  await run.exited;
  const here = relative(root, full);
  const paths =
    run.exitCode === 0 && text.trim() !== ""
      ? text.split("\n").filter(Boolean)
      : (await walkFallback(full)).map((path) => path);
  if (paths.length === 0) return "(empty)";
  const shown = paths.slice(0, DIR_ENTRIES).map((path) => join(here, path));
  return paths.length > DIR_ENTRIES
    ? `${shown.join("\n")}\n[${paths.length - DIR_ENTRIES} more]`
    : shown.join("\n");
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
    // A directory attaches what is in it, not its bytes. Completing to a
    // directory and then being told it does not exist is the worst of both.
    const directory = await stat(full)
      .then((entry) => entry.isDirectory())
      .catch(() => false);
    if (directory) {
      const inside = await directoryListing(root, full);
      if (inside === null) {
        missing.push(path);
        continue;
      }
      attached.push(path);
      blocks.push(`<directory path="${path}">\n${inside}\n</directory>`);
      continue;
    }
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

// Candidates for the composer's `@` completion.
//
// This used to hand-walk the tree, stop at six levels down, and give up after
// 400 entries — whichever 400 readdir happened to reach first. In any real
// repository that meant a file you could see in your editor simply did not
// exist as far as `@` was concerned, which reads as "it doesn't search
// recursively". ripgrep already ships with glrs and already knows how to do
// this: it respects .gitignore, has no depth limit, and is fast enough to run
// against a large repository without anyone noticing.
// One listing serves the whole burst of keystrokes that makes up a query. It is
// re-taken after this long so a file created mid-session shows up without
// anything having to invalidate anything.
const LISTING_TTL_MS = 5_000;
const LISTING_CAP = 20_000;

type Listing = { paths: readonly string[]; at: number };
const listings = new Map<string, Listing>();

// Every directory that contains something, derived from the file list rather
// than listed separately. A directory with no files under it is not somewhere
// you were going to attach from anyway.
const withDirectories = (files: readonly string[]): string[] => {
  const dirs = new Set<string>();
  for (const path of files) {
    const parts = path.split(sep);
    for (let at = 1; at < parts.length; at += 1) dirs.add(`${parts.slice(0, at).join(sep)}${sep}`);
  }
  return [...files, ...dirs];
};

const walkFallback = async (root: string): Promise<string[]> => {
  const found: string[] = [];
  const walk = async (dir: string, depth: number): Promise<void> => {
    if (depth > 12 || found.length > LISTING_CAP) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      // Dot directories are noise to @-completion except the agent's own, which
      // holds the skills and extensions you would want to reference by path.
      if (entry.name.startsWith(".") && entry.name !== ".glrs" && entry.name !== ".glorious")
        continue;
      if (SKIP.includes(entry.name)) continue;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full, depth + 1);
      else found.push(relative(root, full));
    }
  };
  await walk(root, 0);
  return found;
};

const listing = async (root: string, now: number): Promise<readonly string[]> => {
  const cached = listings.get(root);
  if (cached && now - cached.at < LISTING_TTL_MS) return cached.paths;
  const run = Bun.spawn([rgPath, "--files", ...EXCLUDES], {
    cwd: root,
    stdout: "pipe",
    stderr: "ignore",
  });
  const text = await new Response(run.stdout).text().catch(() => "");
  await run.exited;
  const files =
    run.exitCode === 0 && text.trim() !== ""
      ? text.split("\n").filter(Boolean).slice(0, LISTING_CAP)
      : // No ripgrep, or a directory it refuses: the hand-walk still works, it
        // is just slower and does not read .gitignore.
        await walkFallback(root);
  const paths = withDirectories(files);
  listings.set(root, { paths, at: now });
  return paths;
};

// Ranked the way a file picker is: what you typed matching the name beats it
// matching some directory halfway up the path, and a name that starts with it
// beats one that merely contains it. Sorting by depth first — which is what
// this did — put `test/a/b/util.ts` above `utils.ts` for the query `util`.
const rank = (path: string, wanted: string): number => {
  const name = (path.endsWith(sep) ? path.slice(0, -1) : path).split(sep).pop() ?? "";
  const inName = name.toLowerCase().indexOf(wanted);
  if (inName === 0) return 0;
  if (inName > 0) return 1;
  return 2;
};

export const fileCandidates = async (
  root: string,
  query: string,
  cap = 50,
  now = Date.now(),
): Promise<string[]> => {
  const wanted = query.toLowerCase();
  const paths = await listing(root, now);
  return paths
    .filter((path) => path.toLowerCase().includes(wanted))
    .sort(
      (a, b) =>
        rank(a, wanted) - rank(b, wanted) ||
        a.split(sep).length - b.split(sep).length ||
        a.localeCompare(b),
    )
    .slice(0, cap);
};

// Exposed for tests: the listing is cached, and a test that writes a file needs
// to be able to say so without waiting out the TTL.
export const forgetListings = (): void => listings.clear();
