/**
 * Replay ports — Clock and ToolExecutor implementations that replay a
 * recorded log instead of touching the world. Strict replay wires these (plus
 * a log-seeded completion cache) into a fresh runtime so re-running behaviors
 * consumes recorded stamps, tool outputs, and LLM responses; any demand the
 * recording cannot satisfy is itself evidence of divergence.
 *
 * The recorded clock keys off "events produced so far": the shell samples
 * `now()` once per step, before appending, so the correct stamp is the one on
 * the next recorded event. Wire `tracer` into the runtime so the cursor
 * advances with every append.
 */

import { type AnyEvent, canonicalJson } from "../domain/events";
import type { SchemaDef } from "../domain/schema";
import { err, ok } from "../lib/fp";
import type { Clock } from "../ports/clock";
import type { ToolExecutor } from "../ports/tools";
import type { TracerSink } from "../ports/tracer";

export const createRecordedStamps = <S extends SchemaDef>(
  recorded: readonly AnyEvent<S>[],
): { readonly clock: Clock; readonly tracer: TracerSink<S> } => {
  let produced = 0;
  const startMs = recorded.length > 0 ? Date.parse(recorded[0]?.at ?? "") : 0;
  return {
    clock: {
      now: () => recorded[produced]?.at ?? recorded[recorded.length - 1]?.at ?? "",
      monotonicSeconds: () => {
        const at = recorded[produced]?.at ?? recorded[recorded.length - 1]?.at;
        return at === undefined ? 0 : (Date.parse(at) - startMs) / 1000;
      },
    },
    tracer: {
      onEvent: () => {
        produced += 1;
      },
    },
  };
};

/** Replay tool outputs keyed by (tool, canonical input), consumed in call order. */
export const createRecordedTools = <S extends SchemaDef>(
  recorded: readonly AnyEvent<S>[],
): ToolExecutor => {
  const queues = new Map<string, { readonly output: unknown; readonly isError: boolean }[]>();
  const requests = new Map<string, { readonly tool: string; readonly input: unknown }>();
  for (const event of recorded) {
    const type = event.type as string;
    if (type === "tool.requested") {
      const payload = event.payload as { requestId: string; tool: string; input: unknown };
      requests.set(payload.requestId, { tool: payload.tool, input: payload.input });
    } else if (type === "tool.responded") {
      const payload = event.payload as { requestId: string; output: unknown; isError: boolean };
      const request = requests.get(payload.requestId);
      if (request === undefined) continue;
      const key = `${request.tool}\n${canonicalJson(request.input)}`;
      const queue = queues.get(key) ?? [];
      queue.push({ output: payload.output, isError: payload.isError });
      queues.set(key, queue);
    }
  }
  return {
    execute: async (name, input) => {
      const next = queues.get(`${name}\n${canonicalJson(input)}`)?.shift();
      if (next === undefined) {
        return err({ reason: "tool_error", message: `no recorded response for tool ${name}` });
      }
      return next.isError
        ? err({ reason: "tool_error", message: String(next.output) })
        : ok(next.output);
    },
  };
};
