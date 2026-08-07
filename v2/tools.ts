import { stat } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { rgPath } from "@vscode/ripgrep";
import { type ToolSet, tool } from "ai";
import { z } from "zod";
import { errorText } from "./render";
import type { Skills } from "./skills";

export type ToolEvent =
  | { id: number; name: string; detail: string; phase: "start" }
  | { id: number; name: string; detail: string; phase: "end"; ok: boolean };

export type Question = {
  question: string;
  options: string[];
};

export type AskQuestions = (
  questions: Question[],
  signal: AbortSignal | undefined,
) => Promise<string>;

export type RunSubagent = (
  task: string,
  context: string,
  signal: AbortSignal | undefined,
) => Promise<string>;

export type ToolSummary = {
  name: string;
  description: string;
  source: string;
};

const toolSummaries: readonly ToolSummary[] = [
  {
    name: "ask_user",
    description: "Ask the user questions with selectable options.",
    source: "built-in",
  },
  { name: "bash", description: "Run a command in the project root.", source: "built-in" },
  { name: "read", description: "Read a UTF-8 text file.", source: "built-in" },
  { name: "write", description: "Write a UTF-8 text file.", source: "built-in" },
  { name: "edit", description: "Apply exact string replacements to a file.", source: "built-in" },
  {
    name: "grep",
    description: "Search file contents with a regular expression.",
    source: "built-in",
  },
  { name: "glob", description: "List files matching a glob pattern.", source: "built-in" },
];

export const availableToolSummaries = (skills: Skills, runSubagent = false): ToolSummary[] => [
  ...toolSummaries,
  ...(skills.tool
    ? [
        {
          name: "activate_skill",
          description: "Load instructions for an available skill.",
          source: "skills",
        },
      ]
    : []),
  ...(runSubagent
    ? [{ name: "run_subagent", description: "Launch a focused coding agent.", source: "built-in" }]
    : []),
];

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

const patch = (text: string, edit: z.infer<typeof swap>, where: string): string => {
  const at = text.indexOf(edit.old_string);
  if (at < 0)
    throw new Error(`${where}: old_string not found. Nothing was written. Re-read the file.`);
  if (edit.replace_all) return text.split(edit.old_string).join(edit.new_string);
  if (text.includes(edit.old_string, at + edit.old_string.length))
    throw new Error(
      `${where}: old_string is not unique. Nothing was written. Add context or set replace_all.`,
    );
  return text.slice(0, at) + edit.new_string + text.slice(at + edit.old_string.length);
};

export const createTools = (
  root: string,
  onEvent: (event: ToolEvent) => void,
  askQuestions: AskQuestions,
  skills: Skills,
  runSubagent?: RunSubagent,
): ToolSet => {
  const base = resolve(root);
  let seq = 0;

  const announce = (event: ToolEvent): void => {
    try {
      onEvent(event);
    } catch {}
  };

  const within = (target?: string): string => {
    const full = resolve(base, target ?? ".");
    if (full === base || full.startsWith(`${base}${sep}`)) return full;
    throw new Error(`path escapes root: ${target}`);
  };

  const define = <Schema extends z.ZodType>(
    name: string,
    description: string,
    inputSchema: Schema,
    body: (input: z.infer<Schema>, signal: AbortSignal | undefined) => Promise<string>,
  ) =>
    tool({
      description,
      inputSchema,
      execute: async (input: z.infer<Schema>, call: { abortSignal?: AbortSignal }) => {
        const raw = input as Record<string, string | undefined>;
        seq += 1;
        const step = {
          id: seq,
          name,
          detail: raw.command ?? raw.pattern ?? raw.path ?? raw.task ?? "",
        };
        announce({ ...step, phase: "start" });
        const told = await body(input, call.abortSignal).catch((bad) => `ERROR: ${errorText(bad)}`);
        const result = capText(told, RESULT_LIMIT);
        announce({ ...step, phase: "end", ok: !FAILED.test(result) });
        return result;
      },
    });

  const askUser = define(
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

  const runSubagentTool = runSubagent
    ? define(
        "run_subagent",
        "Launch a dedicated coding agent for one focused task. Before calling it, provide a standalone brief with the goal, current findings, relevant files and symbols, constraints, non-goals, acceptance criteria, and checks to run. Include precise paths or snippets; it starts without the parent conversation, plan, or earlier tool results. It can inspect or edit the project with the regular file tools. Do not use it for decisions that need the user.",
        z.object({
          task: z.string().min(1).max(4_000).describe("Self-contained task for the subagent"),
          context: z
            .string()
            .min(1)
            .max(30_000)
            .describe(
              "Standalone brief: goal, current findings, relevant paths and symbols, constraints, non-goals, acceptance criteria, and checks; do not include unrelated conversation history",
            ),
        }),
        async ({ task, context }, signal) => runSubagent(task, context, signal),
      )
    : undefined;

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
      const text = await Bun.file(within(path)).text();
      return text.split("\n").reduce((all, row, n) => `${all}${n ? "\n" : ""}${n + 1}|${row}`, "");
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
    "Change a file with exact string replacements applied in order, each against the result of the previous one. Every old_string must match exactly, whitespace included, and occur exactly once unless replace_all is set — add surrounding lines to make it unique. If any replacement fails nothing is written. Never include the `N|` prefixes shown by read.",
    z.object({
      path: z.string().describe("File to edit, relative to the project root or absolute"),
      edits: z.array(swap).min(1),
    }),
    async ({ path, edits }) => {
      const target = within(path);
      const before = await Bun.file(target).text();
      const tag = (n: number): string => `edit ${n + 1}/${edits.length}`;
      const after = edits.reduce((text, edit, n) => patch(text, edit, tag(n)), before);
      await Bun.write(target, after);
      return `applied ${edits.length} edit(s) to ${path}`;
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
      argv.push(...SKIP_GIT, "-e", input.pattern, within(input.path));
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
      const dir = within(path);
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
    askUser,
    bash,
    read,
    write,
    edit,
    grep,
    glob,
    ...(skills.tool ? { activate_skill: skills.tool } : {}),
    ...(runSubagentTool ? { run_subagent: runSubagentTool } : {}),
  };
};
