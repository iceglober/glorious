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

export type Variant = "minimal" | "low" | "medium" | "high";

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
};

const asVariant = (value: string | undefined): Variant | undefined => {
  if (value === undefined) return undefined;
  const word = value.trim().toLowerCase();
  return word in BUDGET ? (word as Variant) : undefined;
};

// Which provider-options namespace a provider reads. azure is served by the
// openai SDK and reads openai's; vertex serves both Google's own models and
// Anthropic's, and the namespace follows the model rather than the host.
export const namespaceFor = (provider: string, modelId = ""): string => {
  if (provider === "azure") return "openai";
  if (provider === "google-vertex")
    return modelId.toLowerCase().includes("claude") ? "anthropic" : "google";
  if (provider === "amazon-bedrock") return "bedrock";
  if (provider === "google") return "google";
  if (provider === "anthropic") return "anthropic";
  if (provider === "openai") return "openai";
  // Everything else is reached through the OpenAI-compatible client, so it
  // reads the same namespace that client writes.
  return "openai";
};

export type Shape = {
  provider: string;
  modelId?: string;
  /** The configured reasoning effort, in glrs's words. */
  variant?: string;
  /** Stable per-conversation key, for providers that route on one. */
  cacheKey?: string;
};

// The `providerOptions` for one call: exactly one namespace, carrying only what
// that provider actually reads.
export const requestOptions = (shape: Shape): ProviderOptions => {
  const namespace = namespaceFor(shape.provider, shape.modelId);
  const variant = asVariant(shape.variant);
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

  // openai, azure, and every OpenAI-compatible endpoint.
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
      store: false,
    },
  };
};

// Whether a provider caches a prompt prefix without being asked. The ones that
// do not need cache breakpoints written into the messages themselves, which is
// a different seam from `providerOptions` — see `cacheHint`.
export const cachesAutomatically = (provider: string, modelId = ""): boolean =>
  namespaceFor(provider, modelId) === "openai" || namespaceFor(provider, modelId) === "google";

// What to mark a message with so the provider caches everything up to it.
// Anthropic and Bedrock cache only what is explicitly marked; returning
// undefined means the provider needs no mark and the caller writes nothing.
export const cacheHint = (provider: string, modelId = ""): ProviderOptions | undefined => {
  const namespace = namespaceFor(provider, modelId);
  if (namespace === "anthropic")
    return { anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } } };
  if (namespace === "bedrock") return { bedrock: { cachePoint: { type: "default" } } };
  return undefined;
};
