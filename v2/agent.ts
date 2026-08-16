import { createHash } from "node:crypto";
import { type ModelMessage, stepCountIs, streamText } from "ai";
import { createModel, type ModelOption, modelCost } from "./models";
import {
  contextPrompt,
  environmentPrompt,
  navigationPrompt,
  skillsPrompt,
  systemPrompt,
} from "./prompt";
import { type AskQuestions, createTools, type ToolEvent } from "./tools";

const STEP_LIMIT = 100;
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
    // null withholds ask_user, for a run with nobody to answer it
    askQuestions: AskQuestions | null;
    skillTools: import("./skills").Skills;
    mcp?: import("./mcp").McpSession;
    // Handed the turn's event sink and asked afresh each turn, exactly as MCP
    // is: an extension's tools are built once at load, so this is what lets
    // their rows reach the turn that is actually running.
    extensionTools?: (onTool: (event: ToolEvent) => void) => import("ai").ToolSet;
    extensionPrompt?: () => readonly string[];
  };

// Subscribe now so a later throw cannot leave this rejected with nobody
// listening. Bun prints an unhandled rejection straight to stderr, which lands
// at whatever cursor position the TUI happens to be at and shreds the screen.
// The failure still travels — the stream iteration throws it.
export const settleQuietly = <T>(value: PromiseLike<T>, fallback: T): Promise<T> =>
  Promise.resolve(value).catch(() => fallback);

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

  // Extensions land last, so one can deliberately replace a built-in — the same
  // "closest definition wins" rule commands and sequences already follow.
  const toolsFor = (onTool: (event: ToolEvent) => void) => ({
    ...createTools(setup.root, onTool, setup.askQuestions, setup.skillTools),
    ...(setup.mcp?.toolsFor(onTool) ?? {}),
    ...(setup.extensionTools?.(onTool) ?? {}),
  });

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
          cost?: number;
        }) => void;
        onTool: (event: ToolEvent) => void;
        // text as it arrives, so a turn is no longer a silence with a wave over it
        onDelta: (delta: { kind: "text" | "reasoning"; text: string }) => void;
        onReasoningEnd: (reasoning: { text: string; elapsedMs: number }) => void;
        // which part of the model call is in flight, so the wave can say so
        onPhase: (name: "sending" | "waiting" | "thinking" | "writing" | null) => void;
      },
    ) => {
      // What extensions contribute rides in the per-turn message, not the
      // system prompt: the system prompt has to stay byte-identical for the
      // cache, and an extension that registers mid-session would otherwise
      // invalidate it. See PREAMBLE_TAGS.
      const contributed = setup.extensionPrompt?.() ?? [];
      const sent: ModelMessage[] = [
        ...history,
        {
          role: "user",
          content: [
            preamble,
            contributed.length === 0
              ? ""
              : `<extensions>\n${contributed.join("\n")}\n</extensions>`,
            contextPrompt(observed),
            prompt,
          ]
            .filter((part) => part !== "")
            .join("\n\n"),
        },
      ];
      // streamText returns synchronously; its promises settle once the stream
      // below is drained.
      turn.onPhase("sending");
      const result = streamText({
        ...settings(),
        tools: toolsFor(turn.onTool),
        messages: sent,
        abortSignal: turn.signal,
        // The SDK's default is console.error, which writes a raw stack over the
        // alternate screen. The failure still travels: it arrives as an error
        // part and the loop below throws it.
        onError: () => {},
        // the request is away; nothing has come back yet
        onLanguageModelCallStart: () => turn.onPhase("waiting"),
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
          turn.onPhase("writing");
          turn.onDelta({ kind: "text", text: part.text });
          continue;
        }
        if (part.type === "reasoning-start") {
          reasoning = "";
          reasoningSince = Date.now();
          continue;
        }
        if (part.type === "reasoning-delta") {
          turn.onPhase("thinking");
          reasoning += part.text;
          turn.onDelta({ kind: "reasoning", text: part.text });
          continue;
        }
        // between steps the model call is done and tools may run; their own rows
        // report that, so the phase stands down rather than restating it
        if (part.type === "finish-step") turn.onPhase(null);
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
