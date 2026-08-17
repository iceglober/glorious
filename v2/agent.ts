import { createHash } from "node:crypto";
import { generateText, type ModelMessage, stepCountIs, streamText } from "ai";
import { createModel, type ModelOption, modelCost } from "./models";
import { environmentPrompt, skillsPrompt, systemPrompt } from "./prompt";
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

// Bun reports a dropped connection as a plain Error — `name` is "Error" and the
// only signal is `code`. Matching on name alone meant "The socket connection was
// closed unexpectedly" was treated as permanent and killed the turn on the first
// blip, which is exactly the failure a retry exists for.
const RETRY_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ECONNABORTED",
  "EPIPE",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ENETDOWN",
  // transient resolver failure; ENOTFOUND is deliberately absent, being a name
  // that does not exist rather than one that could not be looked up right now
  "EAI_AGAIN",
]);

const CACHE_KEY_CHARS = 32;

// The parts of a model call worth naming while it is in flight. One list:
// index.ts and chat.ts each carried their own copy, and adding a phase to
// one of them was a type error in the other.
export type TurnPhase = "sending" | "waiting" | "thinking" | "writing";

export const worthRetrying = (failure: unknown): boolean => {
  if (failure instanceof TypeError) return true;
  if (!(failure instanceof Error)) return false;
  const code = (failure as Error & { code?: unknown }).code;
  return RETRY_NAMES.has(failure.name) || (typeof code === "string" && RETRY_CODES.has(code));
};

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
// store:false sends reasoning back as content rather than as a server-side
// reference. Left unset, the provider defaults it true and replays reasoning as
// {type:"item_reference", id:"rs_…"}; the turn then dies with "Item with id
// 'rs_…' not found" whenever that lookup misses — an eviction, or a request
// routed to an instance that never saw the write. This client sends its whole
// history every turn, so it gains nothing from server-side state, and false is
// also what makes the provider ask for reasoning.encrypted_content, which is
// what keeps the reasoning replayable at all.
export const providerOptions = (effort: string | undefined, cacheKey: string) => ({
  ...(effort ? { reasoningEffort: effort } : {}),
  textVerbosity: "low" as const,
  promptCacheKey: cacheKey,
  store: false as const,
});

export const settleQuietly = <T>(value: PromiseLike<T>, fallback: T): Promise<T> =>
  Promise.resolve(value).catch(() => fallback);

export const createAgent = (setup: Setup) => {
  let model = createModel(setup.model, fetchWithDeadline as typeof fetch);
  const environment = environmentPrompt(setup);
  // the last context size the provider reported, handed back to the model on the
  // next turn so it can see the budget it is spending
  let observed = 0;
  let preamble = [environment, skillsPrompt(setup.skills)]
    .filter((part) => part !== "")
    .join("\n\n");
  const cacheKey = (scope: string): string =>
    createHash("sha256").update(`${setup.root} ${scope}`).digest("hex").slice(0, CACHE_KEY_CHARS);
  // Modes are gone, so the effort is whatever the model was configured with.
  const openaiOptions = (scope: string) => providerOptions(setup.model.variant, cacheKey(scope));

  // Withheld, not forbidden: a tool the model cannot see cannot be talked into
  // being used. null means everything. This is the seam a read-only mode is
  // written against, now that there is no mode in the core.
  let allowed: readonly string[] | null = null;

  // Extensions land last, so one can deliberately replace a built-in — the same
  // "closest definition wins" rule commands and sequences already follow.
  const toolsFor = (onTool: (event: ToolEvent) => void) => {
    const all = {
      ...createTools(setup.root, onTool, setup.askQuestions, setup.skillTools),
      ...(setup.extensionTools?.(onTool) ?? {}),
    };
    if (allowed === null) return all;
    const keep = new Set(allowed);
    return Object.fromEntries(Object.entries(all).filter(([name]) => keep.has(name)));
  };

  const settings = () => ({
    model,
    instructions: systemPrompt(setup),
    stopWhen: [stepCountIs(STEP_LIMIT)],
    maxRetries: 5,
    providerOptions: { openai: openaiOptions(setup.sessionId) },
  });

  return {
    // Turns the older part of a conversation into something short enough to
    // keep carrying. No tools: this reads what already happened, it does not go
    // looking for more. Its own cache scope, so a compaction never evicts the
    // conversation's own cached prefix.
    summarise: async (
      messages: ModelMessage[],
      instruction: string,
      signal?: AbortSignal,
    ): Promise<string> => {
      const result = await generateText({
        model,
        instructions:
          "You are compacting a coding session so work can continue past the context limit. " +
          "Write a dense brief for the agent that will pick this up with none of the detail " +
          "below in front of it. Keep: what the user asked for and any constraint they gave, " +
          "decisions taken and why, exact paths and symbols touched, what has been verified and " +
          "how, what failed and what that ruled out, and what is left to do. Drop: narration, " +
          "tool output that has served its purpose, and anything already superseded. Prefer " +
          "specifics — a path, a command, an error string — over description of them.",
        maxOutputTokens: 4_000,
        maxRetries: 3,
        providerOptions: { openai: providerOptions(undefined, cacheKey("compact")) },
        messages: [
          ...messages,
          {
            role: "user",
            content: `${instruction}\n\nWrite the brief now. No preamble, no closing remark.`,
          },
        ],
        abortSignal: signal,
      });
      return result.text.trim();
    },
    toolNames: (): readonly string[] => Object.keys(toolsFor(() => {})),
    setTools: (names: readonly string[] | null): void => {
      allowed = names;
    },
    prompt: (): string => systemPrompt(setup),
    setModel: (next: ModelOption): void => {
      setup.model = next;
      model = createModel(next, fetchWithDeadline as typeof fetch);
    },
    setSkills: (skills: Setup["skillTools"]): void => {
      setup.skillTools = skills;
      preamble = [environment, skillsPrompt(skills.catalog)]
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
        onPhase: (name: TurnPhase | null) => void;
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
