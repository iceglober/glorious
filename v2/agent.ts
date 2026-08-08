import { createHash } from "node:crypto";
import { generateText, type ModelMessage, stepCountIs } from "ai";
import { createModel, type ModelOption } from "./models";
import {
  contextPrompt,
  craftRules,
  environmentPrompt,
  fence,
  navigationPrompt,
  skillsPrompt,
  systemPrompt,
} from "./prompt";
import { type AskQuestions, createTools, type RunSubagent, type ToolEvent } from "./tools";

const STEP_LIMIT = 100;
export const SUBAGENT_STEP_LIMIT = 50;
const SUBAGENT_OUTPUT_TOKENS = 12_000;
const DEADLINES_MS = [30 * 60_000, 10 * 60_000, 10 * 60_000];
const BREATH_MS = 500;
const RETRY_NAMES = new Set([
  "TimeoutError",
  "ConnectionError",
  "ConnectTimeoutError",
  "SocketError",
]);

const CACHE_KEY_CHARS = 32;

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

type Setup = Parameters<typeof systemPrompt>[0] &
  Parameters<typeof environmentPrompt>[0] & {
    root: string;
    model: ModelOption;
    sessionId: string;
    skills: string;
    askQuestions: AskQuestions;
    skillTools: import("./skills").Skills;
    mcp?: import("./mcp").McpSession;
  };

// The main loop turns a step-limited turn into a [system-reminder]; a subagent
// has no turn of its own, so the same fact has to travel in the result the
// parent reads. Returning "" would tell the parent nothing at all.
export const subagentReport = (text: string, steps: number): string => {
  const summary = text.trim();
  if (summary !== "") return summary;
  return steps >= SUBAGENT_STEP_LIMIT
    ? "ERROR: the subagent used all its steps without reporting back. Narrow the task or split it into smaller briefs."
    : "ERROR: the subagent finished without reporting anything.";
};

export const createAgent = (setup: Setup) => {
  let model = createModel(setup.model, fetchWithDeadline as typeof fetch);
  const environment = environmentPrompt(setup);
  // the last context size the provider reported, handed back to the model on the
  // next turn so it can see the budget it is spending
  let observed = 0;
  let navigation = navigationPrompt(setup.mcp?.summaries ?? []);
  let preamble = [environment, navigation, skillsPrompt(setup.skills)]
    .filter((part) => part !== "")
    .join("\n\n");
  const cacheKey = (scope: string): string =>
    createHash("sha256").update(`${setup.root} ${scope}`).digest("hex").slice(0, CACHE_KEY_CHARS);
  const openaiOptions = (scope: string) => ({
    ...(setup.model.variant ? { reasoningEffort: setup.model.variant } : {}),
    textVerbosity: "low" as const,
    promptCacheKey: cacheKey(scope),
  });

  const subagentInstructions = `<identity>
  You are a dedicated subagent working for Glorious.
</identity>

${craftRules}

${fence("rules", setup.rules)}

The brief you are given is your complete starting context; do not assume access to the parent conversation, plan, or tool results. Work only on the task in that brief. Inspect the repository when needed, make the requested changes, and verify them with focused checks. You have no way to ask anyone anything and cannot delegate further; decide with what the brief gives you. Return a concise summary of what you did and any checks that ran.`;

  const toolsFor = (onTool: (event: ToolEvent) => void) => {
    const runSubagent: RunSubagent = async (task, context, signal) => {
      const result = await generateText({
        model,
        instructions: subagentInstructions,
        tools: createTools(setup.root, onTool, null, setup.skillTools),
        stopWhen: [stepCountIs(SUBAGENT_STEP_LIMIT)],
        maxOutputTokens: SUBAGENT_OUTPUT_TOKENS,
        maxRetries: 5,
        providerOptions: { openai: openaiOptions("subagent") },
        messages: [
          {
            role: "user",
            content: `<task>\n${task}\n</task>\n\n<context>\n${context}\n</context>`,
          },
        ],
        abortSignal: signal,
      });
      return subagentReport(result.text, result.steps.length);
    };
    return {
      ...createTools(setup.root, onTool, setup.askQuestions, setup.skillTools, runSubagent),
      ...(setup.mcp?.toolsFor(onTool) ?? {}),
    };
  };

  const settings = () => ({
    model,
    instructions: systemPrompt(setup),
    stopWhen: [stepCountIs(STEP_LIMIT)],
    maxRetries: 5,
    providerOptions: { openai: openaiOptions(setup.sessionId) },
  });

  return {
    setModel: (next: ModelOption): void => {
      setup.model = next;
      model = createModel(next, fetchWithDeadline as typeof fetch);
    },
    setSkills: (skills: Setup["skillTools"]): void => {
      setup.skillTools = skills;
      preamble = [environment, navigation, skillsPrompt(skills.catalog)]
        .filter((part) => part !== "")
        .join("\n\n");
    },
    setMcp: (mcp: Setup["mcp"]): void => {
      setup.mcp = mcp;
      navigation = navigationPrompt(mcp?.summaries ?? []);
      preamble = [environment, navigation, skillsPrompt(setup.skillTools.catalog)]
        .filter((part) => part !== "")
        .join("\n\n");
    },
    run: async (
      prompt: string,
      history: ModelMessage[],
      turn: {
        signal: AbortSignal;
        onStep: (step: {
          text: string;
          contextTokens: number;
          cachedTokens: number;
          outputTokens: number;
        }) => void;
        onTool: (event: ToolEvent) => void;
      },
    ) => {
      const sent: ModelMessage[] = [
        ...history,
        {
          role: "user",
          content: [preamble, contextPrompt(observed), prompt]
            .filter((part) => part !== "")
            .join("\n\n"),
        },
      ];
      const result = await generateText({
        ...settings(),
        tools: toolsFor(turn.onTool),
        messages: sent,
        abortSignal: turn.signal,
        onLanguageModelCallEnd: ({ content, usage }) => {
          observed = usage?.inputTokens ?? observed;
          turn.onStep({
            text: content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
            contextTokens: observed,
            cachedTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
          });
        },
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
