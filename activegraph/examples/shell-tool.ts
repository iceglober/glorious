/**
 * The "bash" tool the coding-agent example runs its commands through.
 *
 * It lives in its own module, rather than inline in the runner, so the parts
 * that are easy to get wrong — the working directory, the timeout kill, the
 * output ceiling, the secret redaction — are testable without driving a whole
 * agent.
 *
 * Redaction matters more here than in a throwaway shell. Command output is
 * appended to a durable event log *and* replayed into the reviewer's prompt,
 * so a single `cat .env` would write a live credential to disk forever and
 * hand it to the provider. Values are matched, not names: whatever a
 * secret-shaped variable holds is masked wherever it surfaces.
 */

import type { ToolExecutor } from "../ports/tools";
import type { BashInput } from "./coding-agent";

/** Patterns refused outright, before a shell ever sees them. */
const BLOCKED = /\b(?:sudo|mkfs|shutdown|reboot)\b|rm\s+-rf|git\s+reset\s+--hard/i;

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

export const createShellTool = (options: ShellToolOptions = {}): ToolExecutor => {
  const secrets = secretsIn(options.environment ?? process.env);
  const redact = (text: string) => redactWith(secrets, text);
  return {
    execute: async (_name, rawInput) => {
      const input = rawInput as BashInput;
      if (BLOCKED.test(input.command)) {
        return {
          ok: false,
          error: { reason: "tool_error", message: "Blocked potentially destructive command" },
        };
      }

      const child = Bun.spawn(["bash", "-lc", input.command], {
        cwd: input.cwd,
        timeout: input.timeoutMs,
        maxBuffer: input.maxOutputBytes,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      // Redact once, here, so no caller can forget: everything downstream —
      // the graph, the log, the reviewer's prompt — reads this string.
      const output = redact(`${stdout}${stderr}`.trim());

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
