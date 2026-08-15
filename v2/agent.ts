import { createHash } from "node:crypto";
import { generateText, hasToolCall, type ModelMessage, stepCountIs, streamText } from "ai";
import { createModel, type ModelOption, modelCost } from "./models";
import { DEFAULT_MODE, type Mode } from "./modes";
import {
  contextPrompt,
  craftRules,
  environmentPrompt,
  fence,
  modePrompt,
  navigationPrompt,
  skillsPrompt,
  systemPrompt,
} from "./prompt";
import {
  type AskQuestions,
  createTools,
  PLAN_ONLY_TOOL_NAMES,
  type PresentPlan,
  READ_ONLY_TOOL_NAMES,
  type RunSubagent,
  type ToolEvent,
} from "./tools";

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
    presentPlan: PresentPlan;
    skillTools: import("./skills").Skills;
    mcp?: import("./mcp").McpSession;
  };

// The main loop turns a step-limited turn into a [system-reminder]; a subagent
// has no turn of its own, so the same fact has to travel in the result the
// parent reads. Returning "" would tell the parent nothing at all.
// Subscribe now so a later throw cannot leave this rejected with nobody
// listening. Bun prints an unhandled rejection straight to stderr, which lands
// at whatever cursor position the TUI happens to be at and shreds the screen.
// The failure still travels — the stream iteration throws it.
export const settleQuietly = <T>(value: PromiseLike<T>, fallback: T): Promise<T> =>
  Promise.resolve(value).catch(() => fallback);

export const subagentReport = (text: string, steps: number): string => {
  const summary = text.trim();
  if (summary !== "") return summary;
  return steps >= SUBAGENT_STEP_LIMIT
    ? "ERROR: the subagent used all its steps without reporting back. Narrow the task or split it into smaller briefs."
    : "ERROR: the subagent finished without reporting anything.";
};

// Withhold rather than instruct: a restriction the model can talk itself out of
// is the weak mechanism a mode exists to replace. An MCP tool is only kept if
// its server declared it read-only — there is no way to tell from outside.
export const allowedTools = <T extends Record<string, unknown>>(
  tools: T,
  mode: Mode,
  mcp: readonly { name: string; readOnly: boolean }[],
): T => {
  const planOnly = new Set<string>(PLAN_ONLY_TOOL_NAMES);
  if (!mode.readOnly)
    return Object.fromEntries(Object.entries(tools).filter(([name]) => !planOnly.has(name))) as T;
  const safe = new Set<string>([
    ...READ_ONLY_TOOL_NAMES,
    ...PLAN_ONLY_TOOL_NAMES,
    ...mcp.filter((entry) => entry.readOnly).map((entry) => entry.name),
  ]);
  return Object.fromEntries(Object.entries(tools).filter(([name]) => safe.has(name))) as T;
};

export const createAgent = (setup: Setup) => {
  let model = createModel(setup.model, fetchWithDeadline as typeof fetch);
  const environment = environmentPrompt(setup);
  // the last context size the provider reported, handed back to the model on the
  // next turn so it can see the budget it is spending
  let observed = 0;
  let mode: Mode = DEFAULT_MODE;
  let navigation = navigationPrompt(setup.mcp?.summaries ?? []);
  let preamble = [environment, navigation, skillsPrompt(setup.skills)]
    .filter((part) => part !== "")
    .join("\n\n");
  const cacheKey = (scope: string): string =>
    createHash("sha256").update(`${setup.root} ${scope}`).digest("hex").slice(0, CACHE_KEY_CHARS);
  const effort = (): string | undefined =>
    mode.effort && setup.model.variants?.includes(mode.effort) ? mode.effort : setup.model.variant;
  const openaiOptions = (scope: string) => ({
    ...(effort() ? { reasoningEffort: effort() } : {}),
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
    const runSubagent: RunSubagent = async (task, context, signal, origin) => {
      const result = await generateText({
        model,
        instructions: subagentInstructions,
        // stamped with the row that spawned them, so the session shows one
        // summary line instead of the subagent's whole stream
        tools: createTools(
          setup.root,
          (event) => onTool({ ...event, origin }),
          null,
          setup.skillTools,
        ),
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
    const all = {
      ...createTools(
        setup.root,
        onTool,
        setup.askQuestions,
        setup.skillTools,
        runSubagent,
        setup.presentPlan,
      ),
      ...(setup.mcp?.toolsFor(onTool) ?? {}),
    };
    return allowedTools(all, mode, setup.mcp?.summaries ?? []);
  };

  const settings = () => ({
    model,
    instructions: systemPrompt(setup),
    stopWhen: [stepCountIs(STEP_LIMIT), hasToolCall("present_plan")],
    maxRetries: 5,
    providerOptions: { openai: openaiOptions(setup.sessionId) },
  });

  return {
    mode: (): Mode => mode,
    setMode: (next: Mode): void => {
      mode = next;
    },
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
          cost?: number;
        }) => void;
        onTool: (event: ToolEvent) => void;
        // text as it arrives, so a turn is no longer a silence with a wave over it
        onDelta: (delta: { kind: "text" | "reasoning"; text: string }) => void;
        onReasoningEnd: (reasoning: { text: string; elapsedMs: number }) => void;
      },
    ) => {
      const sent: ModelMessage[] = [
        ...history,
        {
          role: "user",
          content: [preamble, modePrompt(mode), contextPrompt(observed), prompt]
            .filter((part) => part !== "")
            .join("\n\n"),
        },
      ];
      // streamText returns synchronously; its promises settle once the stream
      // below is drained.
      const result = streamText({
        ...settings(),
        tools: toolsFor(turn.onTool),
        messages: sent,
        abortSignal: turn.signal,
        // The SDK's default is console.error, which writes a raw stack over the
        // alternate screen. The failure still travels: it arrives as an error
        // part and the loop below throws it.
        onError: () => {},
        onLanguageModelCallEnd: ({ content, usage }) => {
          observed = usage?.inputTokens ?? observed;
          turn.onStep({
            text: content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join(""),
            contextTokens: observed,
            cachedTokens: usage?.inputTokenDetails?.cacheReadTokens ?? 0,
            outputTokens: usage?.outputTokens ?? 0,
            cost: modelCost(setup.model, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0),
          });
        },
      });
      // A stream error makes the loop below throw, and these three would then be
      // left rejected with nobody listening — Bun prints each stack straight to
      // stderr, on top of the alternate screen. Subscribe before iterating; the
      // throw is what reports the failure.
      const settled = {
        text: settleQuietly(result.text, ""),
        messages: settleQuietly(result.responseMessages, []),
        steps: settleQuietly(result.steps, []),
      };
      let reasoning = "";
      let reasoningSince = 0;
      for await (const part of result.fullStream) {
        // streamText forwards failures into the stream instead of throwing, so
        // without this a failed turn would look like an empty one.
        if (part.type === "error") throw part.error;
        if (part.type === "text-delta") {
          turn.onDelta({ kind: "text", text: part.text });
          continue;
        }
        if (part.type === "reasoning-start") {
          reasoning = "";
          reasoningSince = Date.now();
          continue;
        }
        if (part.type === "reasoning-delta") {
          reasoning += part.text;
          turn.onDelta({ kind: "reasoning", text: part.text });
          continue;
        }
        if (part.type === "reasoning-end" && reasoning.trim() !== "") {
          turn.onReasoningEnd({ text: reasoning, elapsedMs: Date.now() - reasoningSince });
          reasoning = "";
        }
      }
      const [text, responseMessages, steps] = await Promise.all([
        settled.text,
        settled.messages,
        settled.steps,
      ]);
      return {
        text,
        messages: [...sent, ...responseMessages],
        stoppedAtStepLimit: !text.trim() && steps.length >= STEP_LIMIT,
      };
    },
  };
};

export type Agent = ReturnType<typeof createAgent>;
