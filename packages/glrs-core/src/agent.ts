import { createHash } from "node:crypto";
import {
  generateText,
  type ModelMessage,
  stepCountIs,
  streamText,
  type ToolSet,
  type Warning,
} from "ai";
import {
  createModel,
  type JsonObject,
  type ModelOption,
  modelCost,
  NoModelChosen,
  type ProviderOptions,
  requestOptions,
  withCacheBreakpoints,
} from "../../glrs-providers/src";
import { clip, errorText } from "./display";
import { environmentPrompt, skillsPrompt } from "./preamble";
import type { ToolEvent } from "./toolkit";

const STEP_LIMIT = 100;
const FINAL_STEP_PROMPT =
  "The tool step limit has been reached. Answer the current user request now. " +
  "Summarize completed work, remaining work, and blockers. Do not call tools.";

export const isFinalToolStep = (stepNumber: number): boolean => stepNumber >= STEP_LIMIT - 1;
const WARNING_CHARS = 160;
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

// How many times a dropped stream is re-sent before the turn gives up.
const STREAM_ATTEMPTS = 3;

// The parts of a model call worth naming while it is in flight. One list:
// index.ts and chat.ts each carried their own copy, and adding a phase to
// one of them was a type error in the other.
export type TurnPhase = "sending" | "waiting" | "thinking" | "writing";

// Whether a dropped stream can be sent again. Re-sending is safe exactly while
// the attempt is unobservable: nothing written, nothing thought aloud, no tool
// run. A tool call has side effects, so once one has happened the turn cannot
// start over and the failure has to surface.
export const shouldResend = (state: {
  produced: boolean;
  aborted: boolean;
  attempt: number;
  attempts: number;
  failure: unknown;
}): boolean =>
  !state.produced &&
  !state.aborted &&
  state.attempt <= state.attempts &&
  worthRetrying(state.failure);

// Where a steering message goes in the turn's own record. It was appended to
// what the model saw at a step boundary, so in the stored conversation it
// belongs between the step it arrived after and the step that answered it —
// not at the end, where the assistant would appear to have answered it before
// it was said, and a later compaction would summarise it in the wrong order.
export const withInjected = (
  responses: readonly ModelMessage[],
  injected: ReadonlyArray<{ at: number; message: ModelMessage }>,
): ModelMessage[] => {
  const out = responses.slice();
  // Latest insertion first, so an index recorded earlier still counts the same
  // messages it counted when it was recorded. Reversed before the sort because
  // sort is stable: two injections at the same index would otherwise come out
  // swapped.
  for (const { at, message } of [...injected].reverse().sort((a, b) => b.at - a.at))
    out.splice(Math.max(0, Math.min(at, out.length)), 0, message);
  return out;
};

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

// What the warning says, without the thing it is complaining about. The SDK
// embeds that thing in the message, and for "Non-OpenAI reasoning parts are not
// supported" it is the entire reasoning block.
const warningText = (warning: Warning): string => {
  if (warning.type === "deprecated") return `${warning.setting} is deprecated. ${warning.message}`;
  if (warning.type === "other") return warning.message;
  const state = warning.type === "unsupported" ? "is not supported" : "is in compatibility mode";
  return `${warning.feature} ${state}${warning.details === undefined ? "" : `. ${warning.details}`}`;
};

// The first sentence, which is the part that repeats. An `other` warning carries
// the offending value in the rest of the message, so a key made from the whole
// string is unique every time and dedupes nothing.
const warningKey = (text: string): string => text.split(". ")[0].slice(0, 120);

// The SDK logs provider warnings with `process.emitWarning`, which writes to
// stderr at whatever cursor position happens to be current. Over the alternate
// screen that shreds the display, and some provider and model pairings emit one
// per model call carrying a whole reasoning block with it. Same decision as
// `onError` below: the warning still travels, it just travels through glrs.
//
// Deduplicated for the life of the process. These repeat once per call, and the
// second "reasoning parts are not supported" says nothing the first did not.
export const routeProviderWarnings = (report: (message: string) => void): void => {
  const seen = new Set<string>();
  globalThis.AI_SDK_LOG_WARNINGS = ({ warnings, provider, model }) => {
    for (const warning of warnings) {
      const text = warningText(warning);
      const key = `${provider ?? ""} ${model ?? ""} ${warningKey(text)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const scope =
        provider === undefined
          ? "provider"
          : model === undefined
            ? provider
            : `${provider}/${model}`;
      report(`${scope}: ${clip(text, WARNING_CHARS)}`);
    }
  };
};

type Setup = Parameters<typeof environmentPrompt>[0] & {
  root: string;
  // Null until one is chosen. The session opens first and the model arrives
  // second, so everything that needs one asks for it at the moment it runs.
  model: ModelOption | null;
  // Input tokens past which the turn stops rather than taking another step. A
  // turn that reads several large files can go from comfortable to over the
  // window between two steps, and nothing outside the turn is looking: idle is
  // too late and the pre-send check is too early. Undefined means no ceiling is
  // known, which is every model the catalogue cannot size.
  contextCeiling?: () => number | undefined;
  sessionId: string;
  skills: string;
  skillTools: import("./skills").Skills;
  toolTimeoutMs?: number;
  // Handed the turn's event sink and asked afresh each turn, exactly as MCP
  // is: an extension's tools are built once at load, so this is what lets
  // their rows reach the turn that is actually running.
  extensionTools?: (onTool: (event: ToolEvent) => void) => import("ai").ToolSet;
  terminatingTools?: () => ReadonlySet<string>;
  extensionPrompt?: () => readonly string[];
  // The identity, supplied by whatever product is running on this core.
  // Core has none of its own: `You are glrs, a coding agent` is one file in
  // glrs-coding-agent, and a different product supplies a different one.
  // Asked per call so an extension can replace it for a turn.
  instructions: () => string;
  // Every message about to be sent, per model call. Returning an array
  // replaces what is sent for that call only; the stored conversation is
  // untouched, so filtering here never rewrites history.
  onContext?: (
    messages: readonly ModelMessage[],
    step: number,
  ) => Promise<readonly ModelMessage[] | undefined>;
  // The HTTP request to the provider, and its response. This is the layer a
  // gateway, a signing proxy or a request log needs, and it is the one place
  // that sees the payload as the provider will.
  onRequest?: (request: {
    url: string;
    headers: Record<string, string>;
    body: unknown;
  }) => Promise<{ headers?: Record<string, string>; body?: unknown } | undefined>;
  onResponse?: (response: { url: string; status: number; headers: Record<string, string> }) => void;
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
const mergeOptions = (far: JsonObject, near: JsonObject): JsonObject => {
  const output: JsonObject = { ...far };
  for (const [key, value] of Object.entries(near))
    output[key] =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? mergeOptions(
            typeof output[key] === "object" && output[key] !== null && !Array.isArray(output[key])
              ? (output[key] as JsonObject)
              : {},
            value as JsonObject,
          )
        : value;
  return output;
};

export const providerOptions = (
  model: Pick<
    ModelOption,
    "provider" | "modelId" | "modelType" | "variant" | "variants" | "providerOptions"
  >,
  cacheKey: string,
): ProviderOptions =>
  mergeOptions(
    requestOptions({
      provider: model.provider,
      modelId: model.modelId,
      modelType: model.modelType,
      variant: model.variant,
      variants: model.variants,
      cacheKey,
    }) as JsonObject,
    (model.providerOptions ?? {}) as JsonObject,
  ) as ProviderOptions;

export const requestSettings = (
  model: Pick<
    ModelOption,
    "provider" | "modelId" | "modelType" | "variant" | "requestOptions" | "providerOptions"
  >,
  cacheKey: string,
): JsonObject => ({
  ...(model.requestOptions ?? {}),
  providerOptions: providerOptions(model, cacheKey) as JsonObject,
});

export const terminatingToolCalled = (
  steps: readonly {
    toolCalls?: readonly ({ toolName?: string; name?: string } | undefined)[];
  }[],
  names: ReadonlySet<string>,
): boolean =>
  (steps.at(-1)?.toolCalls ?? []).some((call) => names.has(call?.toolName ?? call?.name ?? ""));

export const settleQuietly = <T>(value: PromiseLike<T>, fallback: T): Promise<T> =>
  Promise.resolve(value).catch(() => fallback);

export const createAgent = (setup: Setup) => {
  // Wrapped around the deadline-retrying fetch rather than replacing it, so an
  // extension sees exactly the request that goes out — after retries are set up
  // and before the body is read.
  const providerFetch = async (
    target: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url = typeof target === "string" ? target : String((target as Request).url ?? target);
    let sending = init;
    if (setup.onRequest) {
      const headers = Object.fromEntries(new Headers(init?.headers).entries());
      const raw = typeof init?.body === "string" ? init.body : undefined;
      let body: unknown = raw;
      try {
        body = raw === undefined ? undefined : JSON.parse(raw);
      } catch {}
      const changed = await setup.onRequest({ url, headers, body });
      if (changed) {
        sending = {
          ...init,
          headers: { ...headers, ...(changed.headers ?? {}) },
          body: changed.body === undefined ? init?.body : JSON.stringify(changed.body),
        };
      }
    }
    const response = await fetchWithDeadline(target, sending);
    setup.onResponse?.({
      url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
    });
    return response;
  };

  let model = setup.model === null ? null : createModel(setup.model, providerFetch as typeof fetch);
  // Both halves of the answer, or the refusal. A turn is the first thing that
  // truly needs a model, so this is where its absence is reported rather than
  // at construction: the session, its tools and its transcript all work without
  // one, and only the call to a provider cannot.
  const ready = (): { option: ModelOption; language: NonNullable<typeof model> } => {
    if (setup.model === null || model === null)
      throw new NoModelChosen("No model is selected, so there is nothing to send this to.");
    return { option: setup.model, language: model };
  };
  const environment = environmentPrompt(setup);
  // the last context size the provider reported, handed back to the model on the
  // next turn so it can see the budget it is spending
  let observed = 0;
  let preamble = [environment, skillsPrompt(setup.skills)]
    .filter((part) => part !== "")
    .join("\n\n");
  const cacheKey = (scope: string): string =>
    createHash("sha256").update(`${setup.root} ${scope}`).digest("hex").slice(0, CACHE_KEY_CHARS);
  // Withheld, not forbidden: a tool the model cannot see cannot be talked into
  // being used. An empty list means everything survives. This is the seam a
  // read-only mode is written against, now that there is no mode in the core.
  //
  // The predicates are kept, not the names they matched. This held the resolved
  // list, computed once at the moment a filter was registered — so a tool
  // belonging to an extension that had not loaded yet was absent from that
  // snapshot and stayed withheld for the rest of the session, however
  // permissive the filter itself was. Loading order decided which tools existed.
  let filters: ReadonlyArray<(name: string) => boolean> = [];

  // Every tool the model can call now comes from the registry, including the
  // six that touch the machine — they are the builtins extension, registered
  // through `g.tool` like any other. Which one wins a contested name is decided
  // there, first-claimed-first-kept, rather than by the order of this spread.
  //
  // `activate_skill` is the exception and stays here: it needs the skill's body,
  // which the extension API does not carry. It leads, so an extension can still
  // replace it.
  const toolsFor = (onTool: (event: ToolEvent) => void) => {
    const all = {
      ...(setup.skillTools.tool ? { activate_skill: setup.skillTools.tool } : {}),
      ...(setup.extensionTools?.(onTool) ?? {}),
    };
    if (filters.length === 0) return all;
    // Asked afresh here, per model call, so a tool registered after the filter
    // was is judged by it rather than missed by it.
    return Object.fromEntries(
      Object.entries(all).filter(([name]) => filters.every((keep) => keep(name))),
    );
  };

  const stopAfterTerminatingTool: import("ai").StopCondition<ToolSet> = ({ steps }) =>
    terminatingToolCalled(
      steps as Array<{
        toolCalls?: Array<{ toolName?: string; name?: string } | undefined>;
      }>,
      setup.terminatingTools?.() ?? new Set(),
    );

  // What the provider said the last call carried. The only honest reading of how
  // full the window is mid-turn: an estimate from the messages ignores the tool
  // schemas, the system prompt and the provider's own framing, and at this size
  // those are most of the difference.
  const overCeiling = (): boolean => {
    const ceiling = setup.contextCeiling?.();
    return ceiling !== undefined && observed >= ceiling;
  };

  const settings = (chosen: ReturnType<typeof ready>) => ({
    maxRetries: 5,
    ...requestSettings(chosen.option, cacheKey(setup.sessionId)),
    model: chosen.language,
    instructions: setup.instructions(),
    stopWhen: [stepCountIs(STEP_LIMIT), stopAfterTerminatingTool, overCeiling],
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
      const chosen = ready();
      const result = await generateText({
        maxOutputTokens: 4_000,
        maxRetries: 3,
        ...requestSettings({ ...chosen.option, variant: undefined }, cacheKey("compact")),
        model: chosen.language,
        instructions:
          "You are compacting a coding session so work can continue past the context limit. " +
          "Write a dense brief for the agent that will pick this up with none of the detail " +
          "below in front of it. Keep: what the user asked for and any constraint they gave, " +
          "decisions taken and why, exact paths and symbols touched, what has been verified and " +
          "how, what failed and what that ruled out, and what is left to do. Drop: narration, " +
          "tool output that has served its purpose, and anything already superseded. Prefer " +
          "specifics — a path, a command, an error string — over description of them.",
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
    // Every filter has to agree. It was one list, last writer wins: a
    // read-only extension and a no-network extension would each call setTools,
    // the second would silently undo the first, and neither could see the
    // other. Intersecting composes — a restriction can only ever narrow — and
    // nothing has to know what else is installed.
    setToolFilters: (next: ReadonlyArray<(name: string) => boolean>): void => {
      filters = next;
    },
    prompt: (): string => setup.instructions(),
    setModel: (next: ModelOption): void => {
      setup.model = next;
      model = createModel(next, providerFetch as typeof fetch);
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
        // a dropped stream is being re-sent. Announced rather than silent: a
        // turn that pauses for several seconds and then starts over should say
        // why it did.
        onRetry?: (attempt: number, why: string) => void;
        // Anything the user said while this turn was running, asked for at
        // every step boundary. What it returns is appended to the messages for
        // the next step, so the model reads it before it chooses its next
        // action rather than after the turn has finished going the wrong way.
        // Returning nothing is the normal case and costs a function call.
        onSteer?: () => readonly string[];
      },
    ) => {
      // What extensions contribute rides in the per-turn message, not the
      // system prompt: the system prompt has to stay byte-identical for the
      // cache, and an extension that registers mid-session would otherwise
      // invalidate it. See PREAMBLE_TAGS.
      const chosen = ready();
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
      // A dropped stream is not the same failure as a refused request, and the
      // retry above cannot see it: fetchWithDeadline retries while the request
      // is being made, and a mid-response drop happens long after fetch()
      // resolved, while the body is being read. So a connection that died four
      // tool calls into a long turn threw away the whole turn.
      //
      // Re-sending is safe exactly when nothing has reached the user yet: no
      // text, no reasoning, no tool call. Then the attempt is unobservable and
      // can simply happen again. Once anything has been produced, re-sending
      // would duplicate it — that case still surfaces, and the reminder tells
      // the model it was interrupted.
      let attempt = 0;
      while (true) {
        attempt += 1;
        let produced = false;
        try {
          return await once(() => {
            produced = true;
          });
        } catch (failure) {
          const resend = shouldResend({
            produced,
            aborted: turn.signal.aborted,
            attempt,
            attempts: STREAM_ATTEMPTS,
            failure,
          });
          if (!resend) throw failure;
          turn.onRetry?.(attempt, errorText(failure));
          await Bun.sleep(BREATH_MS * attempt);
        }
      }

      async function once(mark: () => void) {
        // Scoped to the attempt, not the turn: a re-sent stream starts the step
        // loop over, so injections from the attempt that died are not part of
        // what this one will produce. The messages themselves are not lost —
        // chat.ts puts them back when onRetry fires.
        const injected: Array<{ at: number; message: ModelMessage }> = [];
        // streamText returns synchronously; its promises settle once the stream
        // below is drained.
        turn.onPhase("sending");
        // What an extension says to send, which may be a filtered, reordered or
        // redacted view. `sent` — the real conversation — is what gets stored,
        // so this changes the call and never the history.
        const shown = (await setup.onContext?.(sent, attempt)) ?? sent;
        const result = streamText({
          ...settings(chosen),
          tools: toolsFor(turn.onTool),
          // Anthropic and Bedrock cache only what is marked, so the marks go
          // in here rather than in providerOptions. OpenAI and Google cache a
          // prefix unasked and are handed the list unchanged.
          messages: withCacheBreakpoints(
            [...shown],
            chosen.option.provider,
            chosen.option.modelId,
            chosen.option.modelType,
          ),
          abortSignal: turn.signal,
          // The one seam where a message can join a turn already in flight.
          // Appending keeps the cached prefix intact, so steering costs the
          // tokens of what was said and nothing else.
          prepareStep: ({ messages, responseMessages, stepNumber }) => {
            const steering = turn.onSteer?.() ?? [];
            if (isFinalToolStep(stepNumber)) {
              const finalMessages = [...messages];
              if (steering.length > 0) {
                const steeringMessage: ModelMessage = {
                  role: "user",
                  content: steering.join("\n\n"),
                };
                injected.push({ at: responseMessages.length, message: steeringMessage });
                finalMessages.push(steeringMessage);
              }
              finalMessages.push({ role: "user", content: FINAL_STEP_PROMPT });
              return { messages: finalMessages, toolChoice: "none" as const };
            }
            if (steering.length === 0) return {};
            const message: ModelMessage = { role: "user", content: steering.join("\n\n") };
            // Recorded against how many response messages exist right now,
            // which is the position this has to reappear at when the turn's
            // messages are stored.
            injected.push({ at: responseMessages.length, message });
            return { messages: [...messages, message] };
          },
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
              cost: modelCost(chosen.option, usage?.inputTokens ?? 0, usage?.outputTokens ?? 0),
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
          // A tool call has side effects, so once one has run the attempt is no
          // longer unobservable and must not be re-sent.
          if (part.type === "tool-call") mark();
          if (part.type === "text-delta") {
            mark();
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
            mark();
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
          // Steering messages are appended by prepareStep, so they are in
          // neither `sent` nor `responseMessages`. Left out here the model
          // would have answered something the stored conversation never says
          // was asked.
          messages: [...sent, ...withInjected(responseMessages, injected)],
          stoppedAtStepLimit: !text.trim() && steps.length >= STEP_LIMIT,
          stoppedForContext: overCeiling(),
        };
      }
    },
  };
};

export type Agent = ReturnType<typeof createAgent>;
