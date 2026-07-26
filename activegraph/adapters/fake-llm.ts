/**
 * Deterministic LLM adapters for tests and offline runs. `createFakeLlm`
 * wraps a pure responder function (same request → same response);
 * `createScriptedLlm` replays a fixed list of responses in call order and
 * errs when the script runs dry. No real provider adapters ship in v1 — a
 * future ai-sdk adapter slots in behind the same `LlmPort`.
 */

import type { LlmRequest, LlmResponse } from "../domain/effects";
import { err, ok } from "../lib/fp";
import type { LlmPort } from "../ports/llm";

export const createFakeLlm = (respond: (request: LlmRequest) => string | LlmResponse): LlmPort => ({
  complete: async (request) => {
    const response = respond(request);
    return ok(typeof response === "string" ? { text: response } : response);
  },
});

export const createScriptedLlm = (script: readonly (string | LlmResponse)[]): LlmPort => {
  let cursor = 0;
  return {
    complete: async () => {
      const next = script[cursor++];
      if (next === undefined) {
        return err({
          reason: "provider_error",
          message: `script exhausted after ${script.length} calls`,
        });
      }
      return ok(typeof next === "string" ? { text: next } : next);
    },
  };
};

/** An LlmPort that must never be reached (strict replay serves from cache). */
export const createUnreachableLlm = (label = "unreachable"): LlmPort => ({
  complete: async () =>
    err({ reason: "provider_error", message: `llm port called during ${label}` }),
});
