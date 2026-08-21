import type { AzureModelType } from "./config";
import { type BuiltinProviderId, providerSpec } from "./providers";

// How a request is shaped for the provider and concrete endpoint that will
// answer it. Caching is deliberately classified separately from reasoning:
// the same host can expose endpoint types with different option schemas.

export type Variant = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

// The AI SDK carries provider options as JSON, so this is JSON-shaped rather
// than `unknown` — otherwise it will not satisfy the SDK's own option type.
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type ProviderOptions = Record<string, Record<string, JsonValue>>;

// Token budgets for the providers that want a number rather than a word. These
// are glrs's reading of what each word should buy, not something a provider
// publishes — the words are the interface, and this is the one place they turn
// into budgets, so a provider is never handed a number from nowhere.
const BUDGET: Record<Variant, number> = {
  minimal: 1024,
  low: 4096,
  medium: 12288,
  high: 24576,
  xhigh: 32768,
  max: 65536,
};

const asVariant = (value: string | undefined): Variant | undefined => {
  if (value === undefined) return undefined;
  const word = value.trim().toLowerCase();
  return word in BUDGET ? (word as Variant) : undefined;
};

export const azureModelTypeFor = (modelId: string, configured?: AzureModelType): AzureModelType =>
  configured ?? (modelId.toLowerCase().includes("deepseek") ? "deepseek" : "responses");

// Which provider-options namespace a provider reads. Azure Responses and
// DeepSeek use `azure`; Azure Chat is implemented by the OpenAI chat adapter,
// which reads `openai`. Vertex follows the served model rather than the host.
export const namespaceFor = (
  provider: string,
  modelId = "",
  modelType?: AzureModelType,
): string => {
  if (provider === "azure")
    return azureModelTypeFor(modelId, modelType) === "chat" ? "openai" : "azure";
  if (provider === "google-vertex")
    return modelId.toLowerCase().includes("claude") ? "anthropic" : "google";
  if (provider === "amazon-bedrock") return "bedrock";
  if (provider === "google") return "google";
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  // Unknown provider ids use the generic OpenAI-compatible client. Its common
  // options namespace is not `openai`, even though its wire format is similar.
  if (!providerSpec(provider)) return "openaiCompatible";
  return provider;
};

export type Shape = {
  provider: string;
  modelId?: string;
  modelType?: AzureModelType;
  /** The configured reasoning effort, in glrs's words. */
  variant?: string;
  /** Stable per-conversation key, for endpoints that route on one. */
  cacheKey?: string;
};

export type CacheOwner = "glrs" | "extension";
export type CacheStrategy =
  | { kind: "routing-key"; namespace: "openai" | "azure" }
  | { kind: "message-breakpoint"; namespace: "anthropic" | "bedrock" }
  | { kind: "automatic" }
  | { kind: "provider-managed" }
  | { kind: "extension-managed" };

type StrategyFor = (shape: Shape) => CacheStrategy;
const automatic: StrategyFor = () => ({ kind: "automatic" });
const providerManaged: StrategyFor = () => ({ kind: "provider-managed" });
const routingKey =
  (namespace: "openai" | "azure"): StrategyFor =>
  () => ({
    kind: "routing-key",
    namespace,
  });
const breakpoint =
  (namespace: "anthropic" | "bedrock"): StrategyFor =>
  () => ({
    kind: "message-breakpoint",
    namespace,
  });

// Exhaustive by construction: adding a built-in provider requires choosing its
// cache contract here. `provider-managed` means its installed SDK exposes no
// portable cache control; glrs preserves stable prefixes and sends no invented
// option. Provider extensions are classified separately below and own caching.
const BUILTIN_CACHE_STRATEGIES = {
  anthropic: breakpoint("anthropic"),
  openai: routingKey("openai"),
  azure: (shape) => {
    const modelType = azureModelTypeFor(shape.modelId ?? "", shape.modelType);
    if (modelType === "deepseek") return { kind: "provider-managed" };
    return { kind: "routing-key", namespace: modelType === "chat" ? "openai" : "azure" };
  },
  google: automatic,
  "google-vertex": (shape) =>
    shape.modelId?.toLowerCase().includes("claude")
      ? { kind: "message-breakpoint", namespace: "anthropic" }
      : { kind: "automatic" },
  "amazon-bedrock": breakpoint("bedrock"),
  openrouter: providerManaged,
  groq: providerManaged,
  mistral: providerManaged,
  deepseek: providerManaged,
  cerebras: providerManaged,
  cohere: providerManaged,
  xai: providerManaged,
  perplexity: providerManaged,
  togetherai: providerManaged,
} satisfies Record<BuiltinProviderId, StrategyFor>;

export const cacheStrategyFor = (shape: Shape, owner: CacheOwner = "glrs"): CacheStrategy => {
  if (owner === "extension") return { kind: "extension-managed" };
  const provider = providerSpec(shape.provider);
  return provider
    ? BUILTIN_CACHE_STRATEGIES[provider.id as BuiltinProviderId](shape)
    : // A configured OpenAI-compatible endpoint may cache its own prefixes,
      // but there is no portable request control in the compatible SDK.
      { kind: "provider-managed" };
};

// The `providerOptions` for one call: exactly one namespace, carrying only what
// that endpoint adapter reads. Configured options are merged over these defaults
// by the caller.
export const requestOptions = (shape: Shape, cacheOwner: CacheOwner = "glrs"): ProviderOptions => {
  const namespace = namespaceFor(shape.provider, shape.modelId, shape.modelType);
  const variant = asVariant(shape.variant);
  // The compatible client has no portable cache control, and provider
  // extensions own their protocol. Exact configured providerOptions are merged
  // after this return, so either can still opt into controls it understands.
  if (!providerSpec(shape.provider)) return {};
  const budget = variant === undefined ? undefined : BUDGET[variant];

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
                ...(variant === "minimal" ? {} : { maxReasoningEffort: variant }),
              },
            }),
      },
    };

  const strategy = cacheStrategyFor(shape, cacheOwner);
  const cacheOptions: Record<string, JsonValue> = {};
  if (strategy.kind === "routing-key" && shape.cacheKey !== undefined)
    cacheOptions.promptCacheKey = shape.cacheKey;

  if (
    shape.provider === "azure" &&
    azureModelTypeFor(shape.modelId ?? "", shape.modelType) === "deepseek"
  )
    return {
      azure: {
        ...(variant === undefined ? {} : { reasoningEffort: variant }),
      },
    };

  // OpenAI Responses, Azure Responses, and Azure Chat share this option shape.
  // `store: false` keeps reasoning replayable from the history glrs sends rather
  // than relying on provider-side response-item state.
  if (namespace === "openai" || namespace === "azure")
    return {
      [namespace]: {
        ...(variant === undefined ? {} : { reasoningEffort: variant }),
        textVerbosity: "low",
        ...cacheOptions,
        store: false,
      },
    };

  // The remaining native SDKs have no glrs-managed option beyond the provider
  // families handled above. User configuration can still supply exact options.
  return { [namespace]: {} };
};

// Kept as the simple capability predicate used by callers that only need to
// know whether no message breakpoint is required.
export const cachesAutomatically = (
  provider: string,
  modelId = "",
  modelType?: AzureModelType,
): boolean => {
  const strategy = cacheStrategyFor({ provider, modelId, modelType });
  return strategy.kind === "routing-key" || strategy.kind === "automatic";
};

// What to mark a message with so the provider caches everything up to it.
export const cacheHint = (
  provider: string,
  modelId = "",
  modelType?: AzureModelType,
  owner: CacheOwner = "glrs",
): ProviderOptions | undefined => {
  const strategy = cacheStrategyFor({ provider, modelId, modelType }, owner);
  if (strategy.kind !== "message-breakpoint") return undefined;
  if (strategy.namespace === "anthropic")
    return { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } };
  return { bedrock: { cachePoint: { type: "default" } } };
};

// The mark goes on the second-to-last message: everything through it is the
// newest prefix guaranteed to survive into the next turn. Providers match on
// prefixes, so advancing this point extends the existing entry. A shorter
// conversation has no stable prefix and is left untouched.
export const withCacheBreakpoints = <Message extends object>(
  messages: readonly Message[],
  provider: string,
  modelId = "",
  modelType?: AzureModelType,
  owner: CacheOwner = "glrs",
): Message[] => {
  const hint = cacheHint(provider, modelId, modelType, owner);
  if (hint === undefined || messages.length < 2) return [...messages];
  const at = messages.length - 2;
  return messages.map((message, index) => {
    if (index !== at) return message;
    const already = (message as { providerOptions?: Record<string, unknown> }).providerOptions;
    return { ...message, providerOptions: { ...(already ?? {}), ...hint } } as Message;
  });
};
