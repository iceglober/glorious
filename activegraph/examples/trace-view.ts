/**
 * A readable running commentary, rendered from the events as they append.
 *
 * The default trace prints every event with its canonical payload, which is
 * what you want when debugging the runtime and not what you want while an
 * agent works: a five-command plan buries the one line that matters under a
 * hundred lines of JSON. This renders the handful of events a person is
 * actually watching for, and returns null for the rest, so
 * `ACTIVEGRAPH_TRACE=1` can still hand back the firehose.
 *
 * Commands are narrated by `withProgress` rather than from here, because the
 * events cannot say when one started — see `tool-progress.ts`.
 */

import type { AnyEvent } from "../domain/events";
import type { SchemaDef } from "../domain/schema";

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
  const payload = event.payload as Record<string, unknown>;

  switch (event.type as string) {
    case "behavior.started":
      return WORKING[payload.behavior as string] ?? null;
    case "behavior.failed":
      return `${payload.behavior as string} failed: ${innermostMessage(String(payload.reason))}`;
    case "approval.proposed":
      return "  waiting for approval";
    default:
      return null;
  }
};
