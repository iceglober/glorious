/**
 * The "bash" tool the coding-agent example runs its commands through.
 *
 * It lives in its own module, rather than inline in the runner, so the parts
 * that are easy to get wrong — the working directory, the timeout kill, the
 * output ceiling — are testable without driving a whole agent.
 */

import type { ToolExecutor } from "../ports/tools";
import type { BashInput } from "./coding-agent";

/** Patterns refused outright, before a shell ever sees them. */
const BLOCKED = /\b(?:sudo|mkfs|shutdown|reboot)\b|rm\s+-rf|git\s+reset\s+--hard/i;

export const createShellTool = (): ToolExecutor => ({
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
    const output = `${stdout}${stderr}`.trim();

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
});
