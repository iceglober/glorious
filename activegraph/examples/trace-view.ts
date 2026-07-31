/**
 * A readable running commentary, rendered from the events as they append.
 *
 * The default trace prints every event with its canonical payload, which is
 * what you want when debugging the runtime and not what you want while an
 * agent works: a five-command plan buries the one line that matters — which
 * command is running right now — under a hundred lines of JSON. This renders
 * the handful of events a person is actually watching for, and returns null
 * for the rest, so `ACTIVEGRAPH_TRACE=1` can still hand back the firehose.
 */

import type { AnyEvent } from "../domain/events";
import type { SchemaDef } from "../domain/schema";

/** Longest command shown before eliding the middle; keeps the line scannable. */
const MAX_COMMAND = 100;

const elide = (value: string, limit: number): string => {
  const single = value.replace(/\s+/g, " ").trim();
  if (single.length <= limit) return single;
  const half = Math.floor((limit - 1) / 2);
  return `${single.slice(0, half)}…${single.slice(-half)}`;
};

/** The innermost human sentence in a nested error, JSON-wrapped or not. */
export const innermostMessage = (reason: string): string => {
  const brace = reason.indexOf("{");
  if (brace === -1) return reason;
  try {
    const parsed = JSON.parse(reason.slice(brace)) as { message?: string; reason?: string };
    return parsed.message ?? parsed.reason ?? reason;
  } catch {
    return reason;
  }
};

const WORKING: Record<string, string> = {
  planner: "planning…",
  reviewer: "reviewing the output…",
};

export const renderEvent = <S extends SchemaDef>(event: AnyEvent<S>): string | null => {
  const type = event.type as string;
  const payload = event.payload as Record<string, unknown>;

  switch (type) {
    case "behavior.started": {
      return WORKING[payload.behavior as string] ?? null;
    }
    case "tool.requested": {
      const input = payload.input as { command?: string };
      return input.command === undefined ? null : `$ ${elide(input.command, MAX_COMMAND)}`;
    }
    case "tool.responded": {
      return payload.isError === true ? "  failed" : "  ok";
    }
    case "behavior.failed": {
      const behavior = payload.behavior as string;
      return `${behavior} failed: ${innermostMessage(String(payload.reason))}`;
    }
    case "approval.proposed": {
      return "  waiting for approval";
    }
    default:
      return null;
  }
};
