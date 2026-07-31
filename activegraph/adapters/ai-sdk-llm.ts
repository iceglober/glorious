/** Azure AI SDK adapter for the ActiveGraph LlmPort. */
import { createAzure } from "@ai-sdk/azure";
import { generateText, type LanguageModel } from "ai";
import type { LlmRequest, LlmUsage } from "../domain/effects";
import { err, ok } from "../lib/fp";
import type { LlmPort } from "../ports/llm";

const API_KEY_ENV_VARS = [
  "AZURE_FOUNDRY_API_KEY",
  "AZURE_API_KEY",
  "AZURE_OPENAI_API_KEY",
] as const;

/** The slice of the AI SDK's usage report this adapter carries through. */
interface GeneratedUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly inputTokenDetails?: { readonly cacheReadTokens?: number };
  readonly outputTokenDetails?: { readonly reasoningTokens?: number };
}

type TextGenerator = (request: {
  readonly model: LanguageModel;
  readonly system: string;
  readonly prompt: string;
  readonly temperature?: number;
  readonly abortSignal?: AbortSignal;
}) => Promise<{ readonly text: string; readonly usage?: GeneratedUsage }>;

/** Drop absent counts so the recorded response stays canonically stable. */
const toUsage = (usage: GeneratedUsage | undefined): LlmUsage | undefined => {
  const counts: LlmUsage = {
    ...(usage?.inputTokens === undefined ? {} : { inputTokens: usage.inputTokens }),
    ...(usage?.outputTokens === undefined ? {} : { outputTokens: usage.outputTokens }),
    ...(usage?.outputTokenDetails?.reasoningTokens === undefined
      ? {}
      : { reasoningTokens: usage.outputTokenDetails.reasoningTokens }),
    ...(usage?.inputTokenDetails?.cacheReadTokens === undefined
      ? {}
      : { cachedInputTokens: usage.inputTokenDetails.cacheReadTokens }),
  };
  return Object.keys(counts).length === 0 ? undefined : counts;
};

export interface AzureLlmOptions {
  /** Default deployment. A request may name another through `LlmRequest.model`. */
  readonly model: string;
  readonly apiKey?: string;
  readonly resourceName?: string;
  /** Optional sampling temperature. Omit for reasoning models such as GPT-5. */
  readonly temperature?: number;
  /** Maximum time to wait for one provider request. */
  readonly timeoutMs?: number;
  /** Dependency-injection seam for tests; production callers should omit it. */
  readonly generate?: TextGenerator;
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/** Create an LlmPort backed by an Azure OpenAI deployment. */
export const createAzureLlm = (options: AzureLlmOptions): LlmPort => {
  const apiKey = options.apiKey ?? API_KEY_ENV_VARS.map((name) => process.env[name]).find(Boolean);
  if (!apiKey) {
    throw new Error(
      "Azure API key missing: set AZURE_FOUNDRY_API_KEY, AZURE_API_KEY, or AZURE_OPENAI_API_KEY.",
    );
  }

  const resourceName = options.resourceName ?? process.env.AZURE_RESOURCE_NAME;
  if (!resourceName) throw new Error("Azure resource missing: set AZURE_RESOURCE_NAME.");

  const provider = createAzure({ apiKey, resourceName });
  const generate: TextGenerator =
    options.generate ??
    ((request) =>
      generateText({
        model: request.model,
        system: request.system,
        prompt: request.prompt,
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.abortSignal === undefined ? {} : { abortSignal: request.abortSignal }),
      }));

  return {
    complete: async (request: LlmRequest) => {
      try {
        const abortSignal = AbortSignal.timeout(options.timeoutMs ?? 5 * 60_000);
        // The request's deployment wins, so a behavior that names its model
        // gets that model — and, because the request is what the runtime
        // hashes, a model swap can never be served from another model's cache.
        const generateRequest = {
          model: provider(request.model ?? options.model),
          system: request.system ?? "",
          prompt: request.prompt,
          abortSignal,
          ...(options.generate
            ? request.temperature === undefined
              ? {}
              : { temperature: request.temperature }
            : options.temperature === undefined
              ? {}
              : { temperature: options.temperature }),
        };
        const response = await generate(generateRequest);
        const usage = toUsage(response.usage);
        return ok({ text: response.text, ...(usage === undefined ? {} : { usage }) });
      } catch (error) {
        return err({ reason: "provider_error", message: messageOf(error) });
      }
    },
  };
};
