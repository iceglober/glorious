import { createAzure } from "@ai-sdk/azure";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { systemPrompt } from "./prompt";
import { createTools, type ToolEvent } from "./tools";

const STEP_LIMIT = 100;
const DEADLINES_MS = [30 * 60_000, 10 * 60_000, 10 * 60_000];
const BREATH_MS = 500;
const RETRY_NAMES = new Set([
  "TimeoutError",
  "ConnectionError",
  "ConnectTimeoutError",
  "SocketError",
]);

const worthRetrying = (failure: unknown): boolean =>
  failure instanceof TypeError || (failure instanceof Error && RETRY_NAMES.has(failure.name));

const fetchWithDeadline = async (
  target: RequestInfo | URL,
  init?: RequestInit,
  [deadline, ...rest]: number[] = DEADLINES_MS,
): Promise<Response> => {
  const caller = init?.signal ?? undefined;
  const clock = AbortSignal.timeout(deadline);
  try {
    return await fetch(target, {
      ...init,
      signal: caller ? AbortSignal.any([caller, clock]) : clock,
    });
  } catch (failure) {
    if (rest.length === 0 || caller?.aborted || !worthRetrying(failure)) throw failure;
    await Bun.sleep(BREATH_MS * (DEADLINES_MS.length - rest.length));
    if (caller?.aborted) throw failure;
    return fetchWithDeadline(target, init, rest);
  }
};

type Setup = Parameters<typeof systemPrompt>[0] & {
  root: string;
  model: string;
  onTool: (event: ToolEvent) => void;
};

export const createAgent = (setup: Setup) => {
  const apiKey =
    process.env.AZURE_FOUNDRY_API_KEY ||
    process.env.AZURE_API_KEY ||
    process.env.AZURE_OPENAI_API_KEY;
  if (!apiKey)
    throw new Error(
      "Azure API key missing: set AZURE_FOUNDRY_API_KEY, AZURE_API_KEY, or AZURE_OPENAI_API_KEY.",
    );

  const settings = {
    model: createAzure({ apiKey, fetch: fetchWithDeadline as typeof fetch })(setup.model),
    instructions: systemPrompt(setup),
    tools: createTools(setup.root, setup.onTool),
    stopWhen: [stepCountIs(STEP_LIMIT)],
    maxRetries: 5,
    providerOptions: { openai: { reasoningEffort: "medium", textVerbosity: "low" } },
  };

  return {
    run: async (
      prompt: string,
      history: ModelMessage[],
      turn: {
        signal: AbortSignal;
        onStep: (step: { text: string; contextTokens: number }) => void;
      },
    ) => {
      const sent: ModelMessage[] = [...history, { role: "user", content: prompt }];
      const result = await generateText({
        ...settings,
        messages: sent,
        abortSignal: turn.signal,
        onLanguageModelCallEnd: ({ content, usage }) =>
          turn.onStep({
            text: content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
            contextTokens: usage?.inputTokens ?? 0,
          }),
      });
      return {
        text: result.text,
        messages: [...sent, ...result.responseMessages],
        stoppedAtStepLimit: !result.text.trim() && result.steps.length >= STEP_LIMIT,
      };
    },
  };
};

export type Agent = ReturnType<typeof createAgent>;
