/**
 * Domain-owned shapes for the two effectful capabilities behaviors may use —
 * LLM completion and tool execution. The shapes live in the domain (they
 * appear inside event payloads and behavior contexts); the ports that
 * *perform* them live in `ports/llm.ts` and `ports/tools.ts` and import these
 * types, never the other way around.
 *
 * Effects performed during a behavior run are recorded as `TraceEntry` values
 * in call order and folded into the log by `settleStep`, giving every LLM and
 * tool interaction a deterministic position between `behavior.started` and
 * the behavior's mutations. The `requestHash` (canonical-JSON FNV-1a) is the
 * cache key that lets replay and forks serve responses straight from the log.
 */

export interface LlmRequest {
  readonly system?: string;
  readonly prompt: string;
  readonly model?: string;
  readonly temperature?: number;
}

/**
 * Provider-reported token counts, when the adapter can supply them. Recorded
 * inside `llm.responded`, so what a run cost is durable and replayable rather
 * than something you have to reconstruct from a dashboard.
 */
export interface LlmUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  /** Reasoning tokens, billed as output by the models that expose them. */
  readonly reasoningTokens?: number;
  /** Input tokens the provider served from its own prompt cache. */
  readonly cachedInputTokens?: number;
}

export interface LlmResponse {
  readonly text: string;
  readonly usage?: LlmUsage;
}

export type LlmError =
  | { readonly reason: "no_llm_port" }
  | { readonly reason: "provider_error"; readonly message: string };

export type ToolError =
  | { readonly reason: "no_tool_executor" }
  | { readonly reason: "tool_error"; readonly message: string };

/** One effect performed during a behavior run, recorded in call order. */
export type TraceEntry =
  | {
      readonly kind: "llm";
      readonly requestHash: string;
      readonly request: LlmRequest;
      readonly response: LlmResponse;
      readonly cached: boolean;
    }
  | {
      readonly kind: "tool";
      readonly tool: string;
      readonly input: unknown;
      readonly output: unknown;
      readonly isError: boolean;
    };
