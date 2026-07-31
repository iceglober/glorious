/**
 * Narrating a command while it runs, which the event log cannot do.
 *
 * `tool.requested` and `tool.responded` are collected as trace entries inside
 * the behavior and only materialized when the step settles, so both carry the
 * step's single clock stamp: a twelve-second command appends two events with
 * identical timestamps, after it has already finished. The log therefore knows
 * that a command ran and not how long it took, and a tracer cannot report
 * progress because nothing is appended while the work happens.
 *
 * So progress belongs where the waiting happens. This decorator wraps a
 * ToolExecutor, announces the command, keeps saying "still running" while it
 * takes its time, and reports how long it actually took.
 */

import type { ToolExecutor } from "../ports/tools";
import { elide } from "./coding-agent";

export interface Heartbeat {
  readonly start: () => void;
  readonly stop: () => void;
}

export const createHeartbeat = (options: {
  readonly everyMs: number;
  readonly write: (line: string) => void;
  readonly now?: () => number;
}): Heartbeat => {
  const now = options.now ?? (() => Date.now());
  let timer: ReturnType<typeof setInterval> | undefined;
  let began = 0;
  return {
    start: () => {
      began = now();
      timer = setInterval(() => {
        options.write(`  …still running (${Math.round((now() - began) / 1000)}s)`);
      }, options.everyMs);
      // Never a reason to hold the process open on its own account.
      timer.unref?.();
    },
    stop: () => {
      if (timer !== undefined) clearInterval(timer);
      timer = undefined;
    },
  };
};

/** Longest command shown before eliding the middle; keeps the line scannable. */
const MAX_COMMAND = 100;

/**
 * What to print for a command about to run.
 *
 * A coding agent writes files with heredocs, and a heredoc flattened onto one
 * line is gibberish — which is the moment the operator most wants to know what
 * is happening to their repository. So a command that will not survive being
 * put on a line gives way to the planner's own description of it.
 */
export const announce = (command: string, description?: string): string => {
  const oneLine = command.trim();
  const readable = !oneLine.includes("\n") && oneLine.length <= MAX_COMMAND;
  if (readable) return oneLine;
  const label = description?.trim() ?? "";
  return label === "" || label === oneLine ? elide(command, MAX_COMMAND) : label;
};

const took = (ms: number): string => (ms >= 100 ? ` (${(ms / 1000).toFixed(1)}s)` : "");

export const withProgress = (
  inner: ToolExecutor,
  options: {
    readonly write: (line: string) => void;
    readonly everyMs?: number;
    readonly now?: () => number;
  },
): ToolExecutor => {
  const now = options.now ?? (() => Date.now());
  return {
    execute: async (name, input) => {
      const { command, description } = input as { command?: string; description?: string };
      if (command === undefined) return inner.execute(name, input);

      options.write(`$ ${announce(command, description)}`);
      const beat = createHeartbeat({
        everyMs: options.everyMs ?? 5_000,
        write: options.write,
        ...(options.now === undefined ? {} : { now: options.now }),
      });
      const began = now();
      beat.start();
      try {
        const result = await inner.execute(name, input);
        options.write(`  ${result.ok ? "ok" : "failed"}${took(now() - began)}`);
        return result;
      } finally {
        beat.stop();
      }
    },
  };
};
