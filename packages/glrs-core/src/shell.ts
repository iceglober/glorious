import { resolve } from "node:path";

// Running a command and reading back what it said. This lives in core because
// both sides of the product need it and neither may import the other: the
// coding agent runs `g.exec` and `!command` through `runShell`, and the tools
// extension builds `bash`, `grep` and `glob` on `launch`. The alternative was
// a second copy of the process-group kill and the output caps, which is how
// two definitions of "how long before we SIGKILL" start disagreeing.

export const RESULT_LIMIT = 30_000;
export const COMMAND_MS = 600_000;
const GRACE_MS = 5_000;
export const STOPPED = "[interrupted]";
export const expired = (timeoutMs: number): string => `[timed out after ${timeoutMs / 1000}s]`;

// What a spawned command produced, before anything decides how to present it.
export type Capture = { out: string; err: string; code: number; note: string };

// What a shell command tells you. `output` is everything, interleaved, for a
// transcript; the rest is for a program deciding what to do next.
export type ShellResult = {
  output: string;
  stdout: string;
  stderr: string;
  code: number;
  ok: boolean;
};

export const capText = (text: string, limit: number): string =>
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
  onChunk: (text: string) => void = () => {},
): Promise<string> => {
  const utf8 = new TextDecoder();
  let text = "";
  let rows = 0;
  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    const piece = utf8.decode(chunk, { stream: true });
    text += piece;
    onChunk(piece);
    rows += piece.split("\n").length - 1;
    if (rows < lineCap) continue;
    onCap();
    break;
  }
  return text;
};

export const launch = async (
  argv: string[],
  cwd: string,
  caller: AbortSignal | undefined,
  lineCap?: number,
  timeoutMs = COMMAND_MS,
  onOutput?: (text: string, stream: "stdout" | "stderr") => void,
): Promise<Capture> => {
  if (caller?.aborted) return { out: "", err: "", code: 130, note: STOPPED };
  const child = Bun.spawn(argv, { cwd, stdout: "pipe", stderr: "pipe", detached: true });
  const clock = AbortSignal.timeout(timeoutMs);
  const stopper = caller ? AbortSignal.any([caller, clock]) : clock;
  const settled = new AbortController();
  let note = "";
  let escalation: ReturnType<typeof setTimeout> | undefined;
  const strike = (why = ""): void => {
    note ||= why;
    signalGroup(child.pid, "SIGTERM");
    escalation ??= setTimeout(() => signalGroup(child.pid, "SIGKILL"), GRACE_MS).unref();
  };
  const bail = (): void => strike(caller?.aborted ? STOPPED : expired(timeoutMs));
  stopper.addEventListener("abort", bail, { once: true, signal: settled.signal });
  const [out, err] = await Promise.all([
    drain(child.stdout, lineCap, strike, (text) => onOutput?.(text, "stdout")),
    drain(
      child.stderr,
      Number.POSITIVE_INFINITY,
      () => {},
      (text) => onOutput?.(text, "stderr"),
    ),
  ]);
  const code = await child.exited;
  settled.abort();
  clearTimeout(escalation);
  return { out, err, code, note };
};

// `output` is everything, for the transcript. `stdout` is kept apart because
// diagnostics on stderr would read as part of the request. Arguments are handed
// to bash as real positional parameters rather than pasted into the command
// text, so `$1` and `$@` mean what a script author expects and nothing has to
// be quoted to stay safe.
export const runShell = async (
  root: string,
  command: string,
  args: readonly string[] = [],
  onOutput?: (text: string, stream: "stdout" | "stderr") => void,
): Promise<ShellResult> => {
  const got = await launch(
    ["bash", "-lc", command, "glrs", ...args],
    resolve(root),
    undefined,
    undefined,
    COMMAND_MS,
    onOutput,
  );
  const parts = [got.out.trimEnd(), got.err.trimEnd()].filter((part) => part.length > 0);
  if (got.note) parts.push(got.note);
  else if (got.code !== 0) parts.push(`[exit ${got.code}]`);
  return {
    output: capText(parts.join("\n"), RESULT_LIMIT),
    stdout: capText(got.out.trimEnd(), RESULT_LIMIT),
    // Kept apart, and kept at all: `ok` collapsed every kind of failure into
    // one bit, so an extension wrapping a linter could not tell exit 1 (it
    // found problems) from exit 127 (it is not installed) — which are opposite
    // situations. An interrupted or timed-out command has no exit code of its
    // own, so it reports the signal's 128+n the way a shell does.
    stderr: capText(got.err.trimEnd(), RESULT_LIMIT),
    code: got.note === "" ? got.code : 130,
    ok: got.note === "" && got.code === 0,
  };
};
