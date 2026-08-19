import { randomUUID } from "node:crypto";
import { chmod, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { z } from "zod";
import type { ToolSpec } from "../../../glrs-core/src";
import { loadAgentRules } from "../../../glrs-core/src/guidance";
import { type Capture, COMMAND_MS, capText, launch } from "../../../glrs-core/src/shell";

// The six tools the model has always had, now registered through the same API
// a tool you write goes through. They were merged straight into the agent
// before this, ahead of every extension, which meant "the core registers no
// tools of its own" was a claim the code did not support — and replacing one
// meant hoping your extension loaded late enough to win.
//
// Nothing here is privileged. `g.tool` wraps these exactly as it wraps yours,
// so they get the same gate, the same result cap and the same rows; and
// because a tool name is first-claimed-first-kept, registering `bash` in
// .glrs/extensions/ replaces this one rather than racing it.

const STDOUT_LIMIT = 20_000;
const STDERR_LIMIT = 9_000;
const SKIP_GIT = ["--glob", "!.git"];

const rgReport = (got: Capture, cap: number, unit: string, blank: string): string => {
  if (got.note) return got.note;
  const rows = got.out.split("\n").filter((row) => row.length > 0);
  const shown = rows.slice(0, cap);
  if (rows.length > shown.length) return `${shown.join("\n")}\n[truncated at ${cap} ${unit}]`;
  if (got.code > 1) return `ERROR: ${got.err.trim() || `ripgrep exited ${got.code}`}`;
  return shown.length > 0 ? shown.join("\n") : blank;
};

const swap = z.object({
  old_string: z.string().min(1),
  new_string: z.string(),
  replace_all: z.boolean().optional(),
});

// Replace a file in one step. Bun.write truncates in place, so a crash or a
// full disk partway through leaves the file half-written; writing beside it and
// renaming means a reader sees either the old file or the new one.
const replaceFile = async (target: string, text: string): Promise<void> => {
  const temp = `${target}.glrs-${randomUUID().slice(0, 8)}`;
  try {
    await Bun.write(temp, text);
    await chmod(temp, (await stat(target)).mode);
    await rename(temp, target);
  } catch (thrown) {
    await rm(temp, { force: true }).catch(() => {});
    throw thrown;
  }
};

const patch = (
  text: string,
  edit: z.infer<typeof swap>,
  where: string,
  batched: boolean,
): string => {
  const at = text.indexOf(edit.old_string);
  if (at < 0)
    throw new Error(
      `${where}: old_string not found${batched ? ", after the earlier edits in this call were applied" : ""}. Nothing was written. Re-read the file.`,
    );
  if (edit.replace_all) return text.split(edit.old_string).join(edit.new_string);
  const hits = text.split(edit.old_string).length - 1;
  if (hits > 1)
    throw new Error(
      `${where}: old_string occurs ${hits} times. Nothing was written. Add surrounding lines to make it unique, or set replace_all.`,
    );
  return text.slice(0, at) + edit.new_string + text.slice(at + edit.old_string.length);
};

// Exported so the tools can be exercised without an extension host around them.
// A test under packages/extensions may not name the coding agent at all — see
// check-boundaries.ts — so a fake `Glrs` is not available to build one from.
// Each literal keeps its own inferred schema — so `execute` sees typed input —
// while the array they go into is uniform. Without this the cast on the way out
// widens every `input` to unknown.
const spec = <Schema extends z.ZodType>(one: ToolSpec<Schema>): ToolSpec => one as ToolSpec;

export const createCodingTools = (root: string, timeoutMs = COMMAND_MS): ToolSpec[] => {
  const base = resolve(root);

  // Relative paths resolve against the project root; absolute ones are taken as
  // given. Nothing is refused. `bash` sits unconfined beside these five, so a
  // path check here never bounded what the agent could touch — it only made the
  // model reach a file the slow way after being told no on the direct one.
  const target = (path?: string): string => resolve(base, path ?? ".");

  return [
    spec({
      name: "bash",
      description:
        "Run a command with bash in the project root. Returns stdout, then stderr, then `[exit N]` when the command fails. Commands are killed after 10 minutes. Use it for builds, tests, git, and package managers; prefer read, write, edit, grep, and glob over cat, sed, find, and shell redirection.",
      input: z.object({ command: z.string().describe("Shell command to run") }),
      execute: async ({ command }, signal) => {
        const got = await launch(["bash", "-lc", command], base, signal, undefined, timeoutMs);
        const parts = [
          capText(got.out.trimEnd(), STDOUT_LIMIT),
          capText(got.err.trimEnd(), STDERR_LIMIT),
        ].filter((part) => part.length > 0);
        if (got.note || got.code !== 0 || parts.length === 0)
          parts.push(got.note || `[exit ${got.code}]`);
        return parts.join("\n");
      },
    }),
    spec({
      name: "read",
      description:
        "Read a UTF-8 text file. Each output line is prefixed with `N|`, its 1-based line number. That prefix is display-only and is not part of the file — never write it back.",
      input: z.object({
        path: z.string().describe("File to read, relative to the project root or absolute"),
      }),
      execute: async ({ path }) => {
        const file = target(path);
        const text = await Bun.file(file).text();
        const numbered = text
          .split("\n")
          .reduce((all, row, n) => `${all}${n ? "\n" : ""}${n + 1}|${row}`, "");
        const rules = await loadAgentRules(base, dirname(file));
        return rules === "" ? numbered : `${numbered}\n\nAGENTS.md guidance:\n${rules}`;
      },
    }),
    spec({
      name: "write",
      description:
        "Write a UTF-8 text file, creating parent directories as needed. Replaces the whole file when it already exists — use edit to change part of an existing file.",
      input: z.object({
        path: z.string().describe("File to write, relative to the project root or absolute"),
        content: z.string().describe("Full file contents"),
      }),
      execute: async ({ path, content }) => {
        await Bun.write(target(path), content);
        return `wrote ${path}`;
      },
    }),
    spec({
      name: "edit",
      description:
        "Change one or more files in a single call. Each entry names a file and the exact string replacements to apply to it, in order, each against the result of the previous one. Every old_string must match exactly, whitespace included, and occur exactly once unless replace_all is set — add surrounding lines to make it unique. Every edit in every file is resolved before anything is written, so if one fails no file changes, and each file is swapped into place rather than rewritten. Prefer one call covering every file you need to touch. Never include the `N|` prefixes shown by read.",
      input: z.object({
        files: z
          .array(
            z.object({
              path: z.string().describe("File to change, relative to the project root or absolute"),
              edits: z.array(swap).min(1),
            }),
          )
          .min(1)
          .describe("Files to change, each with its own edits"),
      }),
      execute: async ({ files }) => {
        // resolve every file first, so one bad edit cannot leave the tree
        // half-changed the way separate per-file calls would
        const staged = await Promise.all(
          files.map(async (entry, n) => {
            const file = target(entry.path);
            const before = await Bun.file(file).text();
            const where =
              files.length === 1 ? "" : `file ${n + 1}/${files.length} (${entry.path}) `;
            const after = entry.edits.reduce(
              (text, swapped, i) =>
                patch(text, swapped, `${where}edit ${i + 1}/${entry.edits.length}`, i > 0),
              before,
            );
            return { target: file, after };
          }),
        );
        for (const { target, after } of staged) await replaceFile(target, after);
        const count = files.reduce((sum, entry) => sum + entry.edits.length, 0);
        return files.length === 1
          ? `applied ${count} edit(s) to ${files[0].path}`
          : `applied ${count} edit(s) across ${files.length} file(s)`;
      },
    }),
    spec({
      name: "grep",
      description:
        "Search file contents with a regular expression (ripgrep syntax). Returns matching lines as `path:line:text`. Respects .gitignore and never looks inside .git; set includeIgnored to reach ignored and hidden files.",
      input: z.object({
        pattern: z.string().describe("Regex to search for"),
        path: z.string().optional().describe("File or directory to search; defaults to the root"),
        glob: z.string().optional().describe('Only search files matching this glob, e.g. "*.ts"'),
        ignoreCase: z.boolean().optional(),
        fixedString: z.boolean().optional().describe("Match the pattern literally, not as a regex"),
        includeIgnored: z.boolean().optional().describe("Also search ignored and hidden files"),
        maxResults: z.number().int().min(1).max(500).default(100),
      }),
      execute: async (input, signal) => {
        const argv = [rgPath, "--with-filename", "--line-number", "--no-heading", "--color=never"];
        if (input.ignoreCase) argv.push("--ignore-case");
        if (input.fixedString) argv.push("--fixed-strings");
        if (input.includeIgnored) argv.push("--no-ignore", "--hidden");
        if (input.glob) argv.push("--glob", input.glob);
        argv.push(...SKIP_GIT, "-e", input.pattern, target(input.path));
        const got = await launch(argv, base, signal, input.maxResults + 1, timeoutMs);
        return rgReport(got, input.maxResults, "matches", "No matches.");
      },
    }),
    spec({
      name: "glob",
      description:
        "List files matching a glob pattern (`**` supported), most recently modified first. Paths are relative to the searched directory. Respects .gitignore and never looks inside .git; set includeIgnored to reach ignored and hidden files.",
      input: z.object({
        pattern: z.string().describe('Glob to match, e.g. "**/*.ts" or "src/*.json"'),
        path: z.string().optional().describe("Directory to list in; defaults to the root"),
        includeIgnored: z.boolean().optional().describe("Also list ignored and hidden files"),
        maxResults: z.number().int().min(1).max(1000).default(200),
      }),
      execute: async ({ pattern, path, includeIgnored, maxResults }, signal) => {
        const dir = target(path);
        if (!(await stat(dir).catch(() => null))?.isDirectory())
          return `ERROR: no such directory: ${path ?? dir}`;
        const argv = [rgPath, "--files", "--sortr", "modified"];
        if (includeIgnored) argv.push("--no-ignore", "--hidden");
        argv.push("--glob", pattern, ...SKIP_GIT);
        const got = await launch(argv, dir, signal, maxResults + 1, timeoutMs);
        return rgReport(got, maxResults, "files", "No files match.");
      },
    }),
  ];
};
