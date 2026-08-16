import { randomUUID } from "node:crypto";
import { chmod, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve, sep } from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { loadAgentRules } from "./guidance";
import { docsPath } from "./prompt";
import { errorText } from "./render";
import type { Skills } from "./skills";

let events = 0;

// Every tool event in the process draws from one counter. chat.ts pairs start
// with end by id inside a single turn, and a turn can be running the parent's
// tools, several subagents' tools, and MCP tools at once — a per-instance
// counter made those collide.
export const nextToolEventId = (): number => {
  events += 1;
  return events;
};

// `input` and `result` are what an extension's renderer draws from — `detail`
// is only ever the one string a generic row can fit.
export type ToolEvent =
  | { id: number; name: string; detail: string; input: Record<string, unknown>; phase: "start" }
  | {
      id: number;
      name: string;
      detail: string;
      input: Record<string, unknown>;
      phase: "end";
      ok: boolean;
      result: string;
    };

export type Question = {
  question: string;
  options: string[];
};

export type AskQuestions = (
  questions: Question[],
  signal: AbortSignal | undefined,
) => Promise<string>;

export const BUILT_IN_TOOL_NAMES = [
  "ask_user",
  "bash",
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "activate_skill",
] as const;

export type BuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number];

const RESULT_LIMIT = 30_000;
const STDOUT_LIMIT = 20_000;
const STDERR_LIMIT = 9_000;
const COMMAND_MS = 600_000;
const GRACE_MS = 5_000;
const SKIP_GIT = ["--glob", "!.git"];
const STOPPED = "[interrupted]";
const EXPIRED = `[timed out after ${COMMAND_MS / 1000}s]`;
const FAILED = /^ERROR:|\[interrupted\]|\[timed out/u;

type Capture = { out: string; err: string; code: number; note: string };

const capText = (text: string, limit: number): string =>
  text.length > limit
    ? `${text.slice(0, limit)}\n[truncated, ${text.length - limit} chars omitted]`
    : text;

const signalGroup = (pid: number, name: NodeJS.Signals): void => {
  try {
    process.kill(-pid, name);
  } catch {}
};

const drain = async (
  stream: ReadableStream<Uint8Array>,
  lineCap = Number.POSITIVE_INFINITY,
  onCap: () => void = () => {},
): Promise<string> => {
  const utf8 = new TextDecoder();
  let text = "";
  let rows = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    const piece = utf8.decode(chunk, { stream: true });
    text += piece;
    rows += piece.split("\n").length - 1;
    if (rows < lineCap) continue;
    onCap();
    break;
  }
  return text;
};

const launch = async (
  argv: string[],
  cwd: string,
  caller: AbortSignal | undefined,
  lineCap?: number,
): Promise<Capture> => {
  if (caller?.aborted) return { out: "", err: "", code: 130, note: STOPPED };
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", detached: true });
  const clock = AbortSignal.timeout(COMMAND_MS);
  const stopper = caller ? AbortSignal.any([caller, clock]) : clock;
  const settled = new AbortController();
  let note = "";
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const strike = (why = ""): void => {
    note ||= why;
    signalGroup(child.pid, "SIGTERM");
    escalation ??= setTimeout(() => signalGroup(child.pid, "SIGKILL"), GRACE_MS).unref();
  };
  const bail = (): void => strike(caller?.aborted ? STOPPED : EXPIRED);
  stopper.addEventListener("abort", bail, { once: true, signal: settled.signal });
  const [out, err] = await Promise.all([drain(child.stdout, lineCap, strike), drain(child.stderr)]);
  const code = await child.exited;
  settled.abort();
  clearTimeout(escalation);
  return { out, err, code, note };
};

// `output` is everything, for the transcript. `stdout` is kept apart because an
// sequence that carries a prompt sends its stdout to the model as data, and
// diagnostics on stderr would read as part of the request. Arguments are handed
// to bash as real positional parameters rather than pasted into the command
// text, so `$1` and `$@` mean what a script author expects and nothing has to
// be quoted to stay safe.
export const runShell = async (
  root: string,
  command: string,
  args: readonly string[] = [],
): Promise<{ output: string; stdout: string; ok: boolean }> => {
  const got = await launch(["bash", "-lc", command, "glorious", ...args], resolve(root), undefined);
  const parts = [got.out.trimEnd(), got.err.trimEnd()].filter((part) => part.length > 0);
  if (got.note) parts.push(got.note);
  else if (got.code !== 0) parts.push(`[exit ${got.code}]`);
  return {
    output: capText(parts.join("\n"), RESULT_LIMIT),
    stdout: capText(got.out.trimEnd(), RESULT_LIMIT),
    ok: got.note === "" && got.code === 0,
  };
};

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
  const temp = `${target}.glorious-${randomUUID().slice(0, 8)}`;
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

// One wrapper for every tool the model can call, built-in or contributed by an
// extension. It is what makes an extension's tool a real tool: the same event
// stream drives the live row, the same 30k cap keeps one call from eating the
// context, and the same catch turns a throw into an `ERROR:` the model can read
// and recover from rather than a dead turn.
export const wrapTool = <Schema extends z.ZodType>(
  onEvent: (event: ToolEvent) => void,
  name: string,
  description: string,
  inputSchema: Schema,
  body: (input: z.infer<Schema>, signal: AbortSignal | undefined, id: number) => Promise<string>,
) => {
  const announce = (event: ToolEvent): void => {
    try {
      onEvent(event);
    } catch {}
  };
  return tool({
    description,
    inputSchema,
    execute: async (input: z.infer<Schema>, call: { abortSignal?: AbortSignal }) => {
      const raw = input as Record<string, unknown>;
      const step = { id: nextToolEventId(), name, detail: firstDetail(raw), input: raw };
      announce({ ...step, phase: "start" });
      const told = await body(input, call.abortSignal, step.id).catch(
        (bad) => `ERROR: ${errorText(bad)}`,
      );
      const result = capText(told, RESULT_LIMIT);
      announce({ ...step, phase: "end", ok: !FAILED.test(result), result });
      return result;
    },
  });
};

const firstDetail = (raw: Record<string, unknown>): string => {
  for (const key of ["command", "pattern", "path", "task"]) {
    const value = raw[key];
    if (typeof value === "string") return value;
  }
  const urls = raw.urls;
  if (Array.isArray(urls)) return urls.length === 1 ? String(urls[0]) : `${urls.length} pages`;
  const files = raw.files;
  if (Array.isArray(files))
    return files.length === 1
      ? String((files[0] as { path?: unknown })?.path ?? "")
      : `${files.length} files`;
  return "";
};

export const createTools = (
  root: string,
  onEvent: (event: ToolEvent) => void,
  askQuestions: AskQuestions | null,
  skills: Skills,
): ToolSet => {
  const base = resolve(root);

  const under = (full: string, root: string): boolean =>
    full === root || full.startsWith(`${root}${sep}`);

  const within = (target?: string): string => {
    const full = resolve(base, target ?? ".");
    if (under(full, base)) return full;
    throw new Error(`path escapes root: ${target}`);
  };

  // Reading also reaches glorious's own docs. The system prompt hands the model
  // an absolute path to them and tells it to read them; confining reads to the
  // project root made that instruction false everywhere except inside the
  // glorious repo itself, and the model routed around it with `bash cat` — a
  // wasted step and a ✗ row about a file that was there all along.
  const readable = (target?: string): string => {
    const full = resolve(base, target ?? ".");
    if (under(full, base) || under(full, docsPath())) return full;
    throw new Error(`path escapes root: ${target}`);
  };

  const define = <Schema extends z.ZodType>(
    name: BuiltInToolName,
    description: string,
    inputSchema: Schema,
    body: (input: z.infer<Schema>, signal: AbortSignal | undefined, id: number) => Promise<string>,
  ) => wrapTool(onEvent, name, description, inputSchema, body);

  const askUser =
    askQuestions === null
      ? undefined
      : define(
          "ask_user",
          "Ask the user one or more questions. Each question must include concise options. The user can choose an option, add a note, or do both. Ask related questions together so the user can answer them in one batch. Use the answers to continue the current task.",
          z.object({
            questions: z
              .array(
                z.object({
                  question: z.string().min(1).describe("Question to show the user"),
                  options: z.array(z.string().min(1)).min(1).max(10).describe("Selectable answers"),
                }),
              )
              .min(1)
              .max(20),
          }),
          async ({ questions }, signal) => askQuestions(questions, signal),
        );

  const bash = define(
    "bash",
    "Run a command with bash in the project root. Returns stdout, then stderr, then `[exit N]` when the command fails. Commands are killed after 10 minutes. Use it for builds, tests, git, and package managers; prefer read, write, edit, grep, and glob over cat, sed, find, and shell redirection.",
    z.object({ command: z.string().describe("Shell command to run") }),
    async ({ command }, signal) => {
      const got = await launch(["bash", "-lc", command], base, signal);
      const parts = [
        capText(got.out.trimEnd(), STDOUT_LIMIT),
        capText(got.err.trimEnd(), STDERR_LIMIT),
      ].filter((part) => part.length > 0);
      if (got.note || got.code !== 0 || parts.length === 0)
        parts.push(got.note || `[exit ${got.code}]`);
      return parts.join("\n");
    },
  );

  const read = define(
    "read",
    "Read a UTF-8 text file. Each output line is prefixed with `N|`, its 1-based line number. That prefix is display-only and is not part of the file — never write it back.",
    z.object({
      path: z.string().describe("File to read, relative to the project root or absolute"),
    }),
    async ({ path }) => {
      const target = readable(path);
      const text = await Bun.file(target).text();
      const numbered = text
        .split("\n")
        .reduce((all, row, n) => `${all}${n ? "\n" : ""}${n + 1}|${row}`, "");
      const rules = await loadAgentRules(base, dirname(target));
      return rules === "" ? numbered : `${numbered}\n\nAGENTS.md guidance:\n${rules}`;
    },
  );

  const write = define(
    "write",
    "Write a UTF-8 text file, creating parent directories as needed. Replaces the whole file when it already exists — use edit to change part of an existing file.",
    z.object({
      path: z.string().describe("File to write, relative to the project root or absolute"),
      content: z.string().describe("Full file contents"),
    }),
    async ({ path, content }) => {
      await Bun.write(within(path), content);
      return `wrote ${path}`;
    },
  );

  const edit = define(
    "edit",
    "Change one or more files in a single call. Each entry names a file and the exact string replacements to apply to it, in order, each against the result of the previous one. Every old_string must match exactly, whitespace included, and occur exactly once unless replace_all is set — add surrounding lines to make it unique. Every edit in every file is resolved before anything is written, so if one fails no file changes, and each file is swapped into place rather than rewritten. Prefer one call covering every file you need to touch. Never include the `N|` prefixes shown by read.",
    z.object({
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
    async ({ files }) => {
      // resolve every file first, so one bad edit cannot leave the tree
      // half-changed the way separate per-file calls would
      const staged = await Promise.all(
        files.map(async (entry, n) => {
          const target = within(entry.path);
          const before = await Bun.file(target).text();
          const where = files.length === 1 ? "" : `file ${n + 1}/${files.length} (${entry.path}) `;
          const after = entry.edits.reduce(
            (text, swapped, i) =>
              patch(text, swapped, `${where}edit ${i + 1}/${entry.edits.length}`, i > 0),
            before,
          );
          return { target, after };
        }),
      );
      for (const { target, after } of staged) await replaceFile(target, after);
      const count = files.reduce((sum, entry) => sum + entry.edits.length, 0);
      return files.length === 1
        ? `applied ${count} edit(s) to ${files[0].path}`
        : `applied ${count} edit(s) across ${files.length} file(s)`;
    },
  );

  const grep = define(
    "grep",
    "Search file contents with a regular expression (ripgrep syntax). Returns matching lines as `path:line:text`. Respects .gitignore and never looks inside .git; set includeIgnored to reach ignored and hidden files.",
    z.object({
      pattern: z.string().describe("Regex to search for"),
      path: z.string().optional().describe("File or directory to search; defaults to the root"),
      glob: z.string().optional().describe('Only search files matching this glob, e.g. "*.ts"'),
      ignoreCase: z.boolean().optional(),
      fixedString: z.boolean().optional().describe("Match the pattern literally, not as a regex"),
      includeIgnored: z.boolean().optional().describe("Also search ignored and hidden files"),
      maxResults: z.number().int().min(1).max(500).default(100),
    }),
    async (input, signal) => {
      const argv = [rgPath, "--with-filename", "--line-number", "--no-heading", "--color=never"];
      if (input.ignoreCase) argv.push("--ignore-case");
      if (input.fixedString) argv.push("--fixed-strings");
      if (input.includeIgnored) argv.push("--no-ignore", "--hidden");
      if (input.glob) argv.push("--glob", input.glob);
      argv.push(...SKIP_GIT, "-e", input.pattern, readable(input.path));
      const got = await launch(argv, base, signal, input.maxResults + 1);
      return rgReport(got, input.maxResults, "matches", "No matches.");
    },
  );

  const glob = define(
    "glob",
    "List files matching a glob pattern (`**` supported), most recently modified first. Paths are relative to the searched directory. Respects .gitignore and never looks inside .git; set includeIgnored to reach ignored and hidden files.",
    z.object({
      pattern: z.string().describe('Glob to match, e.g. "**/*.ts" or "src/*.json"'),
      path: z.string().optional().describe("Directory to list in; defaults to the root"),
      includeIgnored: z.boolean().optional().describe("Also list ignored and hidden files"),
      maxResults: z.number().int().min(1).max(1000).default(200),
    }),
    async ({ pattern, path, includeIgnored, maxResults }, signal) => {
      const dir = readable(path);
      if (!(await stat(dir).catch(() => null))?.isDirectory())
        return `ERROR: no such directory: ${path ?? dir}`;
      const argv = [rgPath, "--files", "--sortr", "modified"];
      if (includeIgnored) argv.push("--no-ignore", "--hidden");
      argv.push("--glob", pattern, ...SKIP_GIT);
      const got = await launch(argv, dir, signal, maxResults + 1);
      return rgReport(got, maxResults, "files", "No files match.");
    },
  );

  return {
    ...(askUser ? { ask_user: askUser } : {}),
    bash,
    read,
    write,
    edit,
    grep,
    glob,
    ...(skills.tool ? { activate_skill: skills.tool } : {}),
  };
};
