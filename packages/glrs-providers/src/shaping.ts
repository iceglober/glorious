import type { AzureModelType } from "./config";

// How a request is shaped for the provider that will answer it.
//
// This used to be one object nested under the `openai` namespace, applied to
// every provider alike:
//
//   providerOptions: { openai: { reasoningEffort, textVerbosity, promptCacheKey, store } }
//
// The openai SDK also answers to azure, so those two worked. Everything else
// received an `openai` key it does not read. `{"model":"anthropic/…","variant":
// "high"}` parsed, passed `doctor`, and had no effect whatever — the config
// validated a setting that could not reach the model.
//
// Reasoning effort is not one setting with one spelling. Each provider models
// it differently, and the shapes below were read out of the installed SDKs
// rather than assumed:
//
//   openai/azure   reasoningEffort: "low" | "medium" | "high"
//   anthropic      thinking: { type: "enabled", budgetTokens }
//   google         thinkingConfig: { thinkingBudget, includeThoughts }
//   amazon-bedrock reasoningConfig: { type, budgetTokens, maxReasoningEffort }
//
// A provider glrs does not know is treated as OpenAI-compatible everywhere
// else, so it is treated as OpenAI-compatible here too.

// Reasoning effort is not a fixed set. models.dev publishes what each model
// accepts in `reasoning_options`, and across the catalogue there are over a
// hundred distinct shapes: ["low","medium","high"], ["minimal","low","medium",
// "high"], ["low","medium","high","xhigh","max"], ["none","high"], and many
// models with no effort scale at all. A union here could only be right for a
// minority, so the value is a string and the model's own list validates it.
// `ModelOption.variants` carries that list, from the catalogue or from config.
export type Variant = string;

// The AI SDK carries provider options as JSON, so this is JSON-shaped rather
// than `unknown` — otherwise it will not satisfy the SDK's own option type.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ProviderOptions = Record<string, Record<string, JsonValue>>;

// Anthropic, Google and Bedrock want a token budget rather than a word. The
// budget comes from where the variant sits in the model's own scale, so a model
// offering three levels spreads over the same range as one offering six. A
// model with no published scale falls back to the ladder below, which is the
// only case where guessing is unavoidable.
const FALLBACK: readonly string[] = ["minimal", "low", "medium", "high", "xhigh", "max"];
const FLOOR = 1024;
const CEILING = 65536;

const budgetFor = (variant: string, scale: readonly string[]): number | undefined => {
  const at = scale.indexOf(variant);
  if (at < 0 || scale.length === 0) return undefined;
  if (scale.length === 1) return CEILING;
  return Math.round(FLOOR + ((CEILING - FLOOR) / (scale.length - 1)) * at);
};

// The variant a caller asked for, if this model accepts it. An unknown value is
// dropped rather than forwarded: a provider that rejects it fails the whole
// turn, and one that ignores it bills for effort nobody chose.
const usesCurrentTurnReasoning = (shape: Shape): boolean =>
  (shape.provider === "openai" ||
    (shape.provider === "azure" && shape.modelType !== "chat" && shape.modelType !== "deepseek")) &&
  /gpt-5\.6(?:[-.]|$)/u.test(shape.modelId ?? "");

const asVariant = (
  value: string | undefined,
  variants: readonly string[] | undefined,
): string | undefined => {
  if (value === undefined) return undefined;
  const word = value.trim().toLowerCase();
  if (word === "") return undefined;
  return (variants ?? FALLBACK).includes(word) ? word : undefined;
};

// Which provider-options namespace a provider reads. Azure's models all read
// `azure`, even though the responses and chat implementations come from the
// OpenAI SDK. Vertex serves both Google's own models and Anthropic's, and the
// namespace follows the model rather than the host.
export const namespaceFor = (
  provider: string,
  modelId = "",
  _modelType?: AzureModelType,
): string => {
  if (provider === "azure") return "azure";
  if (provider === "google-vertex")
    return modelId.toLowerCase().includes("claude") ? "anthropic" : "google";
  if (provider === "amazon-bedrock") return "bedrock";
  if (provider === "google") return "google";
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  // Everything else goes through the OpenAI-compatible client, which reads
  // `providerOptions[<the name it was built with>]` and glrs builds it with the
  // provider id. Writing "openai" here meant every option glrs shaped for a
  // compatible endpoint was dropped on the floor without a word, which is why
  // reaching one at all needed an extension rewriting the request body.
  //
  // camelCase because the client accepts the hyphenated id and deprecates it:
  // `azure-foundry` works and warns on every call, `azureFoundry` is the name
  // it wants.
  return provider.replace(/-([a-z0-9])/gu, (_, char: string) => char.toUpperCase());
};

// Whether a provider is OpenAI's own, rather than something else behind an
// OpenAI-shaped API. `textVerbosity` and `store` are OpenAI's; sending them to
// a model that merely speaks the same protocol is how `azure/grok-4.6` came to
// fail with "Unsupported value: 'low'" on a request nobody thought was about
// verbosity.
const isOpenAI = (provider: string, modelType?: AzureModelType): boolean =>
  provider === "openai" ||
  // On azure the deployment id is arbitrary, so the name cannot say what is
  // behind it. `modelType` can: "responses" is the OpenAI surface, "chat" and
  // "deepseek" are what a Foundry deployment of somebody else's model uses.
  (provider === "azure" && (modelType ?? "responses") === "responses");

export type Shape = {
  provider: string;
  modelId?: string;
  modelType?: AzureModelType;
  /** What this model accepts, from the catalogue. */
  variants?: readonly string[];
  /** The configured reasoning effort, in glrs's words. */
  variant?: string;
  /** Stable per-conversation key, for providers that route on one. */
  cacheKey?: string;
};

// The `providerOptions` for one call: exactly one namespace, carrying only what
// that provider actually reads.
export const requestOptions = (shape: Shape): ProviderOptions => {
  const namespace = namespaceFor(shape.provider, shape.modelId, shape.modelType);
  const variant = asVariant(shape.variant, shape.variants);
  const scale = shape.variants ?? FALLBACK;
  const budget = variant === undefined ? undefined : budgetFor(variant, scale);

  if (namespace === "anthropic")
    return {
      anthropic: {
        ...(budget === undefined ? {} : { thinking: { type: "enabled", budgetTokens: budget } }),
      },
    };

  if (namespace === "google")
    return {
      google: {
        ...(budget === undefined
          ? {}
          : { thinkingConfig: { thinkingBudget: budget, includeThoughts: true } }),
      },
    };

  if (namespace === "bedrock")
    return {
      bedrock: {
        ...(variant === undefined || budget === undefined
          ? {}
          : {
              reasoningConfig: {
                type: "enabled",
                budgetTokens: budget,
                // bedrock takes the word as well as the number, and only these
                // three — "minimal" has no spelling there.
                ...(["low", "medium", "high"].includes(variant)
                  ? { maxReasoningEffort: variant }
                  : {}),
              },
            }),
      },
    };

  if (namespace === "azure") {
    const deepseek =
      shape.modelType === "deepseek" ||
      (shape.modelType === undefined && (shape.modelId ?? "").toLowerCase().includes("deepseek"));
    // Azure hosts models that are not OpenAI's, and they refuse OpenAI's own
    // options rather than ignoring them.
    if (deepseek || !isOpenAI(shape.provider, shape.modelType))
      return {
        azure: {
          ...(variant === undefined ? {} : { reasoningEffort: variant }),
        },
      };
    return {
      azure: {
        ...(variant === undefined ? {} : { reasoningEffort: variant }),
        textVerbosity: "low",
        ...(shape.cacheKey === undefined ? {} : { promptCacheKey: shape.cacheKey }),
        ...(usesCurrentTurnReasoning(shape) ? { reasoningContext: "current_turn" } : {}),
        store: false,
      },
    };
  }

  // Something else behind an OpenAI-shaped API: a Foundry deployment, Ollama,
  // vLLM, a gateway. Reasoning effort is the one option worth trying, because
  // most of them read it; the rest are OpenAI's own and get refused or ignored.
  if (!isOpenAI(shape.provider, shape.modelType))
    return { [namespace]: variant === undefined ? {} : { reasoningEffort: variant } };

  // openai itself.
  //
  // `store: false` is deliberate. With it true the provider keeps server-side
  // reasoning state and answers "Item 'rs_…' not found" whenever that lookup
  // misses. glrs sends its whole history every turn, so it gains nothing from
  // server-side state, and false is also what makes the provider return
  // reasoning.encrypted_content — which is what keeps reasoning replayable.
  return {
    openai: {
      ...(variant === undefined ? {} : { reasoningEffort: variant }),
      textVerbosity: "low",
      ...(shape.cacheKey === undefined ? {} : { promptCacheKey: shape.cacheKey }),
      ...(usesCurrentTurnReasoning(shape) ? { reasoningContext: "current_turn" } : {}),
      store: false,
    },
  };
};

// Whether a provider caches a prompt prefix without being asked. The ones that
// do not need cache breakpoints written into the messages themselves, which is
// a different seam from `providerOptions` — see `cacheHint`.
export const cachesAutomatically = (
  provider: string,
  modelId = "",
  modelType?: AzureModelType,
): boolean => {
  if (provider === "azure")
    return !(
      modelType === "deepseek" ||
      (modelType === undefined && modelId.toLowerCase().includes("deepseek"))
    );
  return (
    namespaceFor(provider, modelId, modelType) === "openai" ||
    namespaceFor(provider, modelId, modelType) === "google"
  );
};

// What to mark a message with so the provider caches everything up to it.
// Anthropic and Bedrock cache only what is explicitly marked; returning
// undefined means the provider needs no mark and the caller writes nothing.
export const cacheHint = (
  provider: string,
  modelId = "",
  modelType?: AzureModelType,
): ProviderOptions | undefined => {
  const namespace = namespaceFor(provider, modelId, modelType);
  if (namespace === "anthropic")
    return { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } };
  if (namespace === "bedrock") return { bedrock: { cachePoint: { type: "default" } } };
  return undefined;
};

// Where to put cache breakpoints in a conversation.
//
// Prompt caching was OpenAI-shaped throughout: a `promptCacheKey` and nothing
// else. OpenAI and Google cache a prompt prefix without being asked, so that
// worked for them and did nothing anywhere else — on Anthropic and Bedrock,
// which cache only what is explicitly marked, every turn re-read the entire
// conversation at full price.
//
// The mark goes on the second-to-last message: everything up to and including
// it is cached, and it is the newest point that will still be present next
// turn. The breakpoint therefore advances each turn, which is deliberate —
// these providers match on prefix, so a longer prefix beginning with the
// cached one still hits and extends it rather than starting over.
//
// A conversation shorter than two messages has no stable prefix to cache, so
// nothing is marked and nothing is paid for.
export const withCacheBreakpoints = <Message extends object>(
  messages: readonly Message[],
  provider: string,
  modelId = "",
  modelType?: AzureModelType,
): Message[] => {
  const hint = cacheHint(provider, modelId, modelType);
  if (hint === undefined || messages.length === 0) return [...messages];
  // Second-to-last normally. On the first turn there is no second-to-last, and
  // marking nothing meant nothing was cached and the second turn re-read the
  // system prompt, the tools and the first message at full price. Marking the
  // only message caches exactly the prefix the second turn opens with.
  const at = Math.max(0, messages.length - 2);
  return messages.map((message, index) => {
    if (index !== at) return message;
    const already = (message as { providerOptions?: Record<string, unknown> }).providerOptions;
    return { ...message, providerOptions: { ...(already ?? {}), ...hint } } as Message;
  });
};
