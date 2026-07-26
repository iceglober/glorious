/**
 * Completion caching. `withCompletionCache` decorates any LlmPort with a
 * hash-keyed cache — the cross-run persistence seam; the runtime additionally
 * seeds a per-branch cache from the log's own llm.responded events (see
 * shell/runtime.ts), which is what makes replay and forks free.
 */

import type { LlmResponse } from "../domain/effects";
import type { AnyEvent } from "../domain/events";
import { hashRequest } from "../domain/events";
import type { SchemaDef } from "../domain/schema";
import type { CompletionCache, LlmPort } from "../ports/llm";

export const createMemoryCompletionCache = (): CompletionCache => {
  const entries = new Map<string, LlmResponse>();
  return {
    get: (requestHash) => entries.get(requestHash),
    set: (requestHash, response) => {
      entries.set(requestHash, response);
    },
  };
};

/** Seed a cache from a recorded log: every llm.responded is a warm entry. */
export const seedCacheFromLog = <S extends SchemaDef>(
  cache: CompletionCache,
  log: Iterable<AnyEvent<S>>,
): CompletionCache => {
  for (const event of log) {
    if ((event.type as string) !== "llm.responded") continue;
    const payload = event.payload as {
      readonly requestHash: string;
      readonly response: LlmResponse;
    };
    if (cache.get(payload.requestHash) === undefined) {
      cache.set(payload.requestHash, payload.response);
    }
  }
  return cache;
};

export const withCompletionCache = (inner: LlmPort, cache: CompletionCache): LlmPort => ({
  complete: async (request) => {
    const key = hashRequest(request);
    const hit = cache.get(key);
    if (hit !== undefined) return { ok: true, value: hit };
    const result = await inner.complete(request);
    if (result.ok) cache.set(key, result.value);
    return result;
  },
});
