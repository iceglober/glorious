import {
  type ToolSet as AiToolSet,
  jsonSchema,
  type LanguageModel,
  type ModelMessage,
  stepCountIs,
  ToolLoopAgent,
  tool,
} from "ai";
import { truncateUnknownWithSpill } from "../truncation";
import { createAzureModelProvider } from "./azure-adapter";
import type {
  AgentRuntime,
  GenerateRequest,
  LlmConfig,
  RunResult,
  RunStep,
  TokenUsage,
  ToolDef,
  ToolSet,
} from "./index";

/** Maximum retries for retryable model responses such as rate limits and 5xx errors. */
export const LLM_MAX_RETRIES = 5;

const createModel = (config: LlmConfig): LanguageModel =>
  createAzureModelProvider(config.azure)(config.model);

/** Minimal structural view of an ai StepResult; decouples us from ai generics. */
interface AiStepLike {
  text?: string;
  toolCalls: readonly { toolName: string; input: unknown }[];
  toolResults: readonly { toolName: string; output?: unknown }[];
}

const mapStepUsage = (step: AiStepLike): { usage?: RunStep["usage"] } => {
  const usage = (
    step as {
      usage?: {
        inputTokens?: number;
        outputTokens?: number;
        totalTokens?: number;
        inputTokenDetails?: {
          noCacheTokens?: number;
          cacheReadTokens?: number;
          cacheWriteTokens?: number;
        };
      };
    }
  ).usage;
  if (!usage) return {};
  const details = usage.inputTokenDetails;
  return {
    usage: {
      inputTokens: usage.inputTokens ?? 0,
      outputTokens: usage.outputTokens ?? 0,
      totalTokens: usage.totalTokens ?? 0,
      ...(details?.noCacheTokens !== undefined
        ? { noCacheInputTokens: details.noCacheTokens }
        : {}),
      ...(details?.cacheReadTokens !== undefined
        ? { cacheReadInputTokens: details.cacheReadTokens }
        : {}),
      ...(details?.cacheWriteTokens !== undefined
        ? { cacheWriteInputTokens: details.cacheWriteTokens }
        : {}),
    },
  };
};

const boundOutput = (
  value: unknown,
  req: Pick<GenerateRequest, "maxOutputChars" | "spill">,
  label: string,
): unknown =>
  req.maxOutputChars === undefined
    ? value
    : truncateUnknownWithSpill(value, req.maxOutputChars, req.spill, label);

const sanitizeHistory = (messages: unknown[], req: GenerateRequest): unknown[] =>
  messages.map((message) => {
    if (
      !message ||
      typeof message !== "object" ||
      (message as { role?: unknown }).role !== "tool"
    ) {
      return message;
    }
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) return message;
    return {
      ...(message as Record<string, unknown>),
      content: content.map((part, index) => {
        if (!part || typeof part !== "object") return part;
        const record = part as Record<string, unknown>;
        const outputKey = "output" in record ? "output" : "result" in record ? "result" : undefined;
        return outputKey
          ? { ...record, [outputKey]: boundOutput(record[outputKey], req, `history-tool-${index}`) }
          : part;
      }),
    };
  });

const mapStep = (step: AiStepLike, req?: GenerateRequest): RunStep => ({
  ...mapStepUsage(step),
  text: step.text ?? "",
  toolCalls: step.toolCalls.map((c) => ({ name: c.toolName, input: c.input })),
  toolResults: step.toolResults.map((tr) => {
    const output = req ? boundOutput(tr.output, req, `tool-${tr.toolName}`) : tr.output;
    return {
      name: tr.toolName,
      output,
      isError:
        (typeof output === "string" && output.startsWith("ERROR")) ||
        (typeof output === "object" &&
          output !== null &&
          ((typeof (output as Record<string, unknown>).exitCode === "number" &&
            (output as Record<string, unknown>).exitCode !== 0) ||
            (output as Record<string, unknown>).success === false ||
            (output as Record<string, unknown>).error != null)),
    };
  }),
});

/** Wrap one ToolDef as an ai `tool()`, forwarding call options verbatim. */
const toAiTool = (def: ToolDef, req: Pick<GenerateRequest, "maxOutputChars" | "spill">) =>
  tool({
    description: def.description,
    inputSchema:
      def.jsonSchema !== undefined
        ? jsonSchema(def.jsonSchema as Parameters<typeof jsonSchema>[0])
        : def.inputSchema,
    execute: async (input, options) => {
      try {
        const output = await def.execute(input, options);
        return boundOutput(output, req, "tool-output");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const bounded = boundOutput(`ERROR: ${message}`, req, "tool-error");
        throw new Error(typeof bounded === "string" ? bounded : String(bounded));
      }
    },
  });

const mapTools = (tools: ToolSet, req: GenerateRequest): AiToolSet =>
  Object.fromEntries(
    Object.keys(tools)
      .sort()
      .map((name) => [name, toAiTool(tools[name], req)]),
  ) as AiToolSet;

/**
 * The AI SDK runtime: a ToolLoopAgent per generate() call (instructions and
 * call settings are per-request), driving the model this factory bound once.
 * The ToolLoopAgent constructor (ai@7) extends LanguageModelCallOptions, so
 * temperature/topP/providerOptions/stopWhen are constructor-level, while
 * abortSignal/onStepFinish are generate()-level.
 */
export const createAiSdkRuntime = (config: LlmConfig): AgentRuntime => {
  const model = createModel(config);

  return {
    async generate(req: GenerateRequest): Promise<RunResult> {
      const agent = new ToolLoopAgent({
        model,
        instructions: req.instructions,
        maxRetries: LLM_MAX_RETRIES,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(req.topP !== undefined ? { topP: req.topP } : {}),
        // Our providerOptions is Record<string, Record<string, unknown>>; the
        // SDK wants JSON-valued options. It is passed through verbatim, so cast
        // at this vendor boundary rather than narrowing the port's shape.
        ...(req.providerOptions
          ? {
              providerOptions: req.providerOptions as Record<string, Record<string, never>>,
            }
          : {}),
        ...(req.stopSteps !== undefined ? { stopWhen: [stepCountIs(req.stopSteps)] } : {}),
        toolOrder: Object.keys(req.tools).sort(),
        tools: mapTools(req.tools, req),
      });

      const onStep = req.onStep;
      // Continuation: prior turns (opaque vendor messages) plus this turn's
      // prompt as the next user message; fresh turns send prompt alone.
      const input: ModelMessage = { role: "user", content: req.prompt };
      const inputMessages = req.messages
        ? [...sanitizeHistory(req.messages, req), input]
        : undefined;
      // The continuation is opaque at the port; this vendor boundary is the
      // one place that re-asserts its true shape (same idiom as providerOptions).
      const result = await agent.generate({
        ...(inputMessages ? { messages: inputMessages as ModelMessage[] } : { prompt: req.prompt }),
        ...(req.abortSignal ? { abortSignal: req.abortSignal } : {}),
        ...(onStep ? { onStepFinish: (step) => onStep(mapStep(step, req)) } : {}),
      });

      const usage = (result as { totalUsage?: typeof result.usage }).totalUsage ?? result.usage;
      const inputTokenDetails = usage.inputTokenDetails as
        | {
            noCacheTokens?: number;
            cacheReadTokens?: number;
            cacheWriteTokens?: number;
          }
        | undefined;
      const mappedUsage: TokenUsage = {
        inputTokens: usage.inputTokens ?? 0,
        outputTokens: usage.outputTokens ?? 0,
        totalTokens: usage.totalTokens ?? 0,
        ...(inputTokenDetails?.noCacheTokens !== undefined
          ? { noCacheInputTokens: inputTokenDetails.noCacheTokens }
          : {}),
        ...(inputTokenDetails?.cacheReadTokens !== undefined
          ? { cacheReadInputTokens: inputTokenDetails.cacheReadTokens }
          : {}),
        ...(inputTokenDetails?.cacheWriteTokens !== undefined
          ? { cacheWriteInputTokens: inputTokenDetails.cacheWriteTokens }
          : {}),
      };
      const finishReason = (result as { finishReason?: string }).finishReason;
      const stepLimit = req.stopSteps ?? 20;
      const responseMessages =
        (result as { response?: { messages?: unknown[] } }).response?.messages ?? [];
      return {
        text: result.text,
        steps: result.steps.map((step) => mapStep(step, req)),
        usage: mappedUsage,
        messages: sanitizeHistory([...(inputMessages ?? [input]), ...responseMessages], req),
        ...(finishReason ? { finishReason } : {}),
        ...(result.steps.length >= stepLimit && result.text.trim() === ""
          ? { stepLimitReached: true }
          : {}),
      };
    },
  };
};
