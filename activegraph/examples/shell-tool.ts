/**
 * The "bash" tool the coding-agent example runs its commands through.
 *
 * It lives in its own module, rather than inline in the runner, so the parts
 * that are easy to get wrong — the working directory, the timeout kill, the
 * output ceiling, the secret redaction — are testable without driving a whole
 * agent.
 *
 * It refuses nothing. Deciding whether a command should run is the agent's
 * job, one layer up, where a risky-looking command parks behind an approval
 * (see `looksDestructive`) rather than being rejected outright — a tool that
 * refused an already-approved command would be answering a question the
 * operator has already answered.
 *
 * Redaction matters more here than in a throwaway shell. Command output is
 * appended to a durable event log *and* replayed into the reviewer's prompt,
 * so a single `cat .env` would write a live credential to disk forever and
 * hand it to the provider. Values are matched, not names: whatever a
 * secret-shaped variable holds is masked wherever it surfaces.
 */

import type { ToolExecutor } from "../ports/tools";
import type { BashInput } from "./coding-agent";

/** Variable names whose values must never reach the log or the model. */
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH/i;

/**
 * Short values are skipped: they collide with ordinary output, and masking
 * every "1" or "true" would mangle results without protecting anything.
 */
const MIN_SECRET_LENGTH = 8;

export interface ShellToolOptions {
  /** Defaults to the secret-shaped variables in the current environment. */
  readonly environment?: Record<string, string | undefined>;
}

const secretsIn = (environment: Record<string, string | undefined>): readonly string[] =>
  Object.entries(environment)
    .filter(([name, value]) => SECRET_NAME.test(name) && (value?.length ?? 0) >= MIN_SECRET_LENGTH)
    .map(([, value]) => value as string)
    // Longest first, so a value that contains another is masked whole.
    .sort((left, right) => right.length - left.length);

const redactWith = (secrets: readonly string[], text: string): string =>
  secrets.reduce((masked, secret) => masked.split(secret).join("[redacted]"), text);

/**
 * Terminal control sequences are presentation, not content. Most tools drop
 * them when stdout is a pipe, but the ones that do not would write cursor
 * moves and colour codes into a durable log, a model's prompt, and the
 * operator's terminal.
 */
// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

// biome-ignore lint/suspicious/noControlCharactersInRegex: matching them is the point
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g;

/**
 * Whether output is not text at all. `cat` on an image, or a `grep` that walks
 * into one, otherwise spends the log's space and the model's context on
 * mojibake — and a NUL or a stray escape can garble the terminal it prints to.
 */
const looksBinary = (text: string): boolean => {
  if (text.length === 0) return false;
  if (text.includes("\u0000")) return true;
  const controls = text.match(CONTROL)?.length ?? 0;
  // Invalid UTF-8 decodes to replacement characters; a few can be legitimate.
  const replacements = text.split("\ufffd").length - 1;
  return (controls + replacements) / text.length > 0.02;
};

export const createShellTool = (options: ShellToolOptions = {}): ToolExecutor => {
  const secrets = secretsIn(options.environment ?? process.env);
  const redact = (text: string) => redactWith(secrets, text);
  return {
    execute: async (_name, rawInput) => {
      const input = rawInput as BashInput;

      // Spawning can fail before the command exists — most plausibly because
      // the working directory is gone, which a coding agent can arrange for
      // itself. The port promises a Result; throwing here would surface as a
      // failed behavior and leave the command pending forever.
      let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
      try {
        child = Bun.spawn(["bash", "-lc", input.command], {
          cwd: input.cwd,
          timeout: input.timeoutMs,
          maxBuffer: input.maxOutputBytes,
          stdout: "pipe",
          stderr: "pipe",
        });
      } catch (error) {
        return {
          ok: false,
          error: {
            reason: "tool_error",
            message: `Could not start the command in ${input.cwd}: ${
              error instanceof Error ? error.message : String(error)
            }`,
          },
        };
      }
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      // Clean once, here, so no caller can forget: everything downstream —
      // the graph, the log, the reviewer's prompt, the terminal — reads this.
      const decoded = `${stdout}${stderr}`.replace(ANSI, "").trim();
      const output = looksBinary(decoded)
        ? `(binary output suppressed: ${decoded.length} characters of non-text data)`
        : redact(decoded);

      // A signal means Bun enforced a limit rather than the command finishing.
      const signal = child.signalCode;
      if (signal !== null) {
        return {
          ok: false,
          error: {
            reason: "tool_error",
            message:
              `Killed by ${signal} after exceeding a limit ` +
              `(timeout ${input.timeoutMs}ms, output ${input.maxOutputBytes} bytes).` +
              (output === "" ? "" : `\nPartial output:\n${output}`),
          },
        };
      }
      return exitCode === 0
        ? { ok: true, value: output }
        : { ok: false, error: { reason: "tool_error", message: output } };
    },
  };
};
