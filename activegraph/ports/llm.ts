/**
 * LlmPort — the completion boundary, plus the cache seam that makes replay
 * and forks free. The request/response shapes are domain vocabulary
 * (`domain/effects.ts`); this port only performs them.
 *
 * The shell's behavior context hashes each canonical request, consults a
 * `CompletionCache` seeded from the branch's own `llm.responded` events, and
 * calls the port only on a miss — so re-running a recorded prefix (strict
 * replay, forks) never re-calls a provider. `withCompletionCache` (adapter)
 * layers a persistent cache across runs on top of the same interface.
 */

import type { LlmError, LlmRequest, LlmResponse } from "../domain/effects";
import type { Result } from "../lib/fp";

export interface LlmPort {
  readonly complete: (request: LlmRequest) => Promise<Result<LlmResponse, LlmError>>;
}

export interface CompletionCache {
  readonly get: (requestHash: string) => LlmResponse | undefined;
  readonly set: (requestHash: string, response: LlmResponse) => void;
}
