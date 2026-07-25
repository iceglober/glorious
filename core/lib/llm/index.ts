import z from "zod";
import type { SpillWriter } from "../truncation";
import { createAiSdkRuntime } from "./ai-sdk-adapter";
import { azureModelConfigSchema } from "./azure-adapter";

/**
 * A tool the agent can call. Our own vendor-free shape, structurally close to
 * the AI SDK's `tool()` on purpose so the ai-sdk adapter maps it 1:1.
 *
 * `execute` returns `unknown`, not `string`: our own tools return strings, but
 * vendor tool providers (bash-tool) return structured objects, and both must
 * survive the round trip through this shape. The optional second arg is opaque
 * call metadata (toolCallId/messages/abortSignal) forwarded verbatim by the
 * adapter, so a vendor tool that reads it still works.
 */
export interface ToolDef<S extends z.ZodType = z.ZodType> {
  description: string;
  inputSchema: S;
  /** Provider-neutral JSON Schema override for runtimes that support it. */
  jsonSchema?: Record<string, unknown>;
  execute: (input: z.infer<S>, options?: unknown) => Promise<unknown> | unknown;
}

/** Inference helper replacing ai's `tool()`; keeps `input` typed from the schema. */
export const defineTool = <S extends z.ZodType>(t: ToolDef<S>): ToolDef<S> => t;

/** A named set of tools handed to the runtime. */
export type ToolSet = Record<string, ToolDef>;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Input tokens sent without a provider prompt-cache hit. */
  noCacheInputTokens?: number;
  /** Input tokens served from the provider prompt cache. */
  cacheReadInputTokens?: number;
  /** Input tokens written to the provider prompt cache. */
  cacheWriteInputTokens?: number;
}

export interface RunStep {
  /** The assistant text generated in this step (empty/absent when the step is
   *  only tool calls). Intermediate steps' text is otherwise lost — only the
   *  final step's text survives in RunResult.text. Real adapters always set it;
   *  optional so terse test fixtures need not. */
  text?: string;
  toolCalls: { name: string; input: unknown }[];
  toolResults: { name: string; output: unknown; isError?: boolean }[];
  /** This step's request usage: inputTokens is the request's full context
   *  size, so live UIs can show both cumulative spend and current window. */
  usage?: TokenUsage;
}

export interface RunResult {
  text: string;
  steps: RunStep[];
  usage: TokenUsage;
  finishReason?: string;
  stepLimitReached?: boolean;
  /**
   * Opaque continuation: the full vendor message history after this turn
   * (input messages + this turn's). Feed back via GenerateRequest.messages to
   * continue the conversation with tool-call memory intact. Only the adapter
   * knows the element shape; callers store/pass it verbatim. Optional so
   * non-chat fakes need not fabricate it; real adapters always populate it.
   */
  messages?: unknown[];
}

export interface GenerateRequest {
  instructions: string;
  prompt: string;
  /** Prior turns (RunResult.messages). When present, `prompt` is appended as
   *  the next user message; when absent, the turn starts fresh from `prompt`. */
  messages?: unknown[];
  tools: ToolSet;
  temperature?: number;
  topP?: number;
  providerOptions?: Record<string, Record<string, unknown>>;
  /** Cap all model-bound tool output, including opaque continuation history. */
  maxOutputChars?: number;
  /** Persist full output when the model-bound value is capped. */
  spill?: SpillWriter;
  /** Cap the tool loop at N steps; omitted → the runtime's default. */
  stopSteps?: number;
  abortSignal?: AbortSignal;
  onStep?: (step: RunStep) => void;
}

/**
 * The runtime port: the LLM external system is model + generation loop behind
 * one boundary. `generate` runs a full tool loop and returns a vendor-free
 * result. The adapter (ai-sdk-adapter.ts) owns the SDK.
 */
export interface AgentRuntime {
  generate(req: GenerateRequest): Promise<RunResult>;
}

/**
 * Serializable model selection; the `llm.*` section of the agent config.
 * Azure is the only provider: `azure.*` is config-first with env fallback
 * (AZURE_FOUNDRY_API_KEY / AZURE_API_KEY, AZURE_RESOURCE_NAME).
 */
export const llmConfigSchema = z.object({
  model: z.string().default("gpt-5.6-luna"),
  /** Call setting; forward to the agent/generate call, not the model. */
  temperature: z.number().min(0).max(2).optional(),
  /** Call setting; nucleus sampling (0–1). Forwarded like temperature. */
  topP: z.number().min(0).max(1).optional(),
  azure: azureModelConfigSchema.prefault({}),
});

export type LlmConfig = z.infer<typeof llmConfigSchema>;

/** The port's factory: hand back the boundary. */
export const createRuntime = (config: LlmConfig): AgentRuntime => createAiSdkRuntime(config);
