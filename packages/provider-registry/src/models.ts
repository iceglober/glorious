import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createAzure } from "@ai-sdk/azure";
import { createCerebras } from "@ai-sdk/cerebras";
import { createCohere } from "@ai-sdk/cohere";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createGoogle } from "@ai-sdk/google";
import { createGoogleVertex } from "@ai-sdk/google-vertex";
import { createGroq } from "@ai-sdk/groq";
import { createMistral } from "@ai-sdk/mistral";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createPerplexity } from "@ai-sdk/perplexity";
import { createTogetherAI } from "@ai-sdk/togetherai";
import { createXai } from "@ai-sdk/xai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import type { LanguageModel } from "ai";
import { type Config, envSetting } from "./config";
import { canonicalProvider, nearestProvider, providerSpec } from "./providers";

export type ModelRef = {
  provider: string;
  modelId: string;
};

export type ModelOption = ModelRef & {
  name: string;
  api?: string;
  apiKey?: string;
  env: readonly string[];
  npm?: string;
  inputCost?: number;
  outputCost?: number;
  context?: number;
  variants?: readonly string[];
  variant?: string;
  region?: string;
  project?: string;
  location?: string;
};

const catalogUrl = "https://models.dev/api.json";

// The catalogue is cached to disk after a successful fetch, so context windows
// and prices survive being offline. Without it the status line falls back to
// `unknown` on the first flight without a network, which is the moment you are
// least able to fix it. Refreshed whenever the fetch succeeds; never trusted
// over a live answer.
const cachePath = (): string =>
  join(process.env.XDG_CACHE_HOME ?? join(homedir(), ".cache"), "glrs", "models.dev.json");

const cached = async (): Promise<unknown | null> => {
  try {
    return JSON.parse(await readFile(cachePath(), "utf8"));
  } catch {
    return null;
  }
};

const remember = async (catalog: unknown): Promise<void> => {
  try {
    await mkdir(dirname(cachePath()), { recursive: true });
    await writeFile(cachePath(), JSON.stringify(catalog), "utf8");
  } catch {}
};

// One request, then the cache. A catalogue that cannot be reached is not an
// error — it costs pricing and context size, not the session.
const catalogue = async (fetcher: typeof fetch): Promise<unknown | null> => {
  try {
    const response = await fetcher(catalogUrl, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
    const parsed = await response.json();
    await remember(parsed);
    return parsed;
  } catch {
    return cached();
  }
};
// Thrown when nothing has chosen a model, and when a model names no provider.
// Both are the same failure from the caller's side: glrs does not know what to
// run, and picking something would be worse than saying so.
export class NoModelChosen extends Error {}

// Every model names its provider. A bare id used to mean azure, which made the
// most likely provider the one nobody chose — and the one whose base URL was
// silently ignored. There is no default now, so a model that names no provider
// is an error rather than a guess.
export const modelRef = (value: string): ModelRef => {
  const slash = value.indexOf("/");
  if (slash < 1)
    throw new NoModelChosen(
      `"${value}" names no provider. Models are written provider/model-id, as in ` +
        "anthropic/claude-opus-4-1 or azure/gpt-5. `glrs doctor` lists what ships.",
    );
  return {
    provider: canonicalProvider(value.slice(0, slash)),
    modelId: value.slice(slash + 1),
  };
};

export const modelLabel = (model: ModelRef): string => `${model.provider}/${model.modelId}`;

export const priceMultiplier = (provider: string): number => {
  const entry = (envSetting("PRICE_MULTIPLIERS") ?? "").split(",").find((item) => {
    const [name] = item.split("=", 1);
    return name?.trim() === provider;
  });
  const multiplier = Number(entry?.split("=", 2)[1]);
  return Number.isFinite(multiplier) && multiplier >= 0 ? multiplier : 1;
};

export const modelCost = (
  model: Pick<ModelOption, "inputCost" | "outputCost">,
  input: number,
  output: number,
): number | undefined =>
  model.inputCost === undefined && model.outputCost === undefined
    ? undefined
    : ((model.inputCost ?? 0) * input + (model.outputCost ?? 0) * output) / 1_000_000;

// Which provider settings each provider actually reads.
//
// Every provider block accepts all four keys, and `providerSettings` below hands
// out only the ones its provider uses — so `{"providers":{"anthropic":{"region":
// "us-east-1"}}}` parsed, validated, merged and then vanished without a word.
// This table is what makes that sayable: a key a provider does not read is now
// a diagnostic rather than silence, and the test suite walks it to prove every
// key it does list survives the trip to the model options.
export const PROVIDER_SETTINGS: Record<string, readonly string[]> = {
  "amazon-bedrock": ["api", "region"],
  "google-vertex": ["api", "project", "location"],
};

// Every other provider — including every OpenAI-compatible endpoint — takes a
// base URL and nothing else.
export const settingsFor = (provider: string): readonly string[] =>
  PROVIDER_SETTINGS[provider] ?? ["api"];

const providerSettings = (
  provider: string,
  config?: Config,
): Pick<ModelOption, "api" | "region" | "project" | "location"> => {
  const metadata = config?.providers?.[provider];
  // `api` is carried for every provider, not only the OpenAI-compatible ones.
  // Bedrock and vertex used to drop it here — the key parsed, validated, merged
  // and then vanished before the model was built, so a private endpoint or a
  // proxy silently went to the public one.
  const api = metadata?.api === undefined ? {} : { api: metadata.api };
  if (provider === "amazon-bedrock")
    return {
      ...api,
      region:
        metadata?.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    };
  if (provider === "google-vertex")
    return {
      ...api,
      project:
        metadata?.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT,
      location:
        metadata?.location ??
        process.env.GOOGLE_CLOUD_LOCATION ??
        process.env.GOOGLE_VERTEX_LOCATION ??
        "global",
    };
  return api;
};

export const currentModel = (config?: Config): ModelOption => {
  const model = envSetting("MODEL") ?? config?.model;
  if (model === undefined || model.trim() === "")
    throw new NoModelChosen(
      "No model is configured. Set one with --model provider/model-id, GLRS_MODEL, or " +
        '{"model": "provider/model-id"} in .glrs/config.json. ' +
        "`glrs doctor` lists the providers that ship.",
    );
  const ref = modelRef(model);
  return {
    ...ref,
    ...providerSettings(ref.provider, config),
    name: model,
    variant: envSetting("VARIANT") ?? config?.variant,
    // From the provider table, so every provider declares its own names rather
    // than azure being special-cased and the rest falling through to whatever
    // their SDK happens to read.
    env: providerSpec(ref.provider)?.env ?? [],
    npm: ref.provider === "azure" ? "@ai-sdk/azure" : undefined,
  };
};

// Every model the catalogue carries, for the extension API's model picker. The
// core does not use this — it has no picker — but an extension that restores
// one needs somewhere to get the list.
export const loadCatalogue = async (
  fetcher: typeof fetch = fetch,
): Promise<readonly ModelOption[]> => {
  const catalog = ((await catalogue(fetcher)) ?? {}) as Record<
    string,
    {
      models?: Record<
        string,
        {
          id?: string;
          name?: string;
          limit?: { context?: number };
          reasoning_options?: Array<{ type?: string; values?: string[] }>;
        }
      >;
    }
  >;
  return Object.entries(catalog).flatMap(([provider, entry]) =>
    Object.entries(entry.models ?? {}).map(([id, spec]) => ({
      provider,
      modelId: spec.id ?? id,
      name: spec.name ?? spec.id ?? id,
      env: [],
      context: spec.limit?.context,
      variants: spec.reasoning_options?.find((option) => option.type === "effort")?.values,
    })),
  );
};

// Context window and per-token pricing for the model that is already selected.
// The picker is gone, but the status line still says `ctx 12.3k(6%)` and the
// percentage needs a denominator — so this is a metadata lookup, not a catalog.
// One request, at startup, silent when it fails: offline the status line reads
// `unknown` and everything else works.
export const modelMetadata = async (
  model: ModelOption,
  fetcher: typeof fetch = fetch,
): Promise<Partial<ModelOption>> => {
  const catalog = ((await catalogue(fetcher)) ?? {}) as Record<
    string,
    {
      api?: string;
      npm?: string;
      models?: Record<
        string,
        {
          id?: string;
          limit?: { context?: number };
          cost?: { input?: number; output?: number };
          reasoning_options?: Array<{ type?: string; values?: string[] }>;
        }
      >;
    }
  >;
  const provider = catalog[model.provider];
  const entry = Object.values(provider?.models ?? {}).find(
    (candidate) => (candidate.id ?? "") === model.modelId,
  );
  if (!entry) return {};
  const scale = priceMultiplier(model.provider);
  return {
    api: model.api ?? provider?.api,
    npm: model.npm ?? provider?.npm,
    context: entry.limit?.context,
    inputCost: entry.cost?.input === undefined ? undefined : entry.cost.input * scale,
    outputCost: entry.cost?.output === undefined ? undefined : entry.cost.output * scale,
    variants: entry.reasoning_options?.find((option) => option.type === "effort")?.values,
  };
};

type ProviderFactory = (options: {
  apiKey?: string;
  baseURL?: string;
  fetch?: typeof fetch;
}) => (id: string) => LanguageModel;

const factories: Record<string, ProviderFactory> = {
  "amazon-bedrock": createAmazonBedrock as ProviderFactory,
  anthropic: createAnthropic as ProviderFactory,
  cerebras: createCerebras as ProviderFactory,
  cohere: createCohere as ProviderFactory,
  deepseek: createDeepSeek as ProviderFactory,
  google: createGoogle as ProviderFactory,
  "google-vertex": createGoogleVertex as ProviderFactory,
  groq: createGroq as ProviderFactory,
  mistral: createMistral as ProviderFactory,
  openai: createOpenAI as ProviderFactory,
  openrouter: createOpenRouter as ProviderFactory,
  perplexity: createPerplexity as ProviderFactory,
  togetherai: createTogetherAI as ProviderFactory,
  xai: createXai as ProviderFactory,
};

// A provider is reachable under several environment names — azure alone answers
// to three — but each SDK falls back to exactly one. The picker already reports
// a provider as connected on any of them, so resolving the same list here is
// what makes "environment credentials available" mean the session can start.
export const resolveApiKey = (option: {
  apiKey?: string;
  env?: readonly string[];
}): string | undefined =>
  option.apiKey ?? option.env?.map((name) => process.env[name]).find((value) => Boolean(value));

export const createModel = (option: ModelOption, fetcher: typeof fetch = fetch): LanguageModel => {
  const apiKey = resolveApiKey(option);
  // azure was the one branch that dropped the base URL, and — being the former
  // default provider — the one most likely to need it. A gateway or a private
  // resource configured through providers.azure.api went to the public
  // endpoint without a word.
  if (option.provider === "azure" || option.npm === "@ai-sdk/azure")
    return createAzure({ apiKey, baseURL: option.api, fetch: fetcher as typeof fetch })(
      option.modelId,
    );
  if (option.provider === "amazon-bedrock")
    return createAmazonBedrock({
      apiKey,
      baseURL: option.api,
      region: option.region,
      fetch: fetcher as typeof fetch,
    })(option.modelId);
  if (option.provider === "google-vertex")
    return createGoogleVertex({
      apiKey,
      project: option.project,
      location: option.location,
      fetch: fetcher as typeof fetch,
    })(option.modelId);
  const factory = factories[option.provider];
  // Anything without a factory of its own is an OpenAI-compatible endpoint —
  // Ollama, LM Studio, vLLM, a gateway, a company proxy. It only needs a base
  // URL, which is the one thing that cannot be guessed. Previously this was
  // reachable only if models.dev happened to publish the provider, so a local
  // server could not be used at all.
  if (option.npm === "@ai-sdk/openai-compatible" || !factory) {
    if (!option.api) {
      const near = nearestProvider(option.provider);
      throw new Error(
        near === undefined
          ? `${option.provider} is not a built-in provider. Give it a base URL to use it as an ` +
              `OpenAI-compatible endpoint: {"providers":{"${option.provider}":{"api":"…"}}}`
          : `Unknown provider "${option.provider}" — did you mean "${near}"?`,
      );
    }
    return createOpenAICompatible({
      name: option.provider,
      apiKey,
      baseURL: option.api,
      fetch: fetcher as typeof fetch,
    })(option.modelId);
  }
  return factory({ apiKey, baseURL: option.api, fetch: fetcher as typeof fetch })(option.modelId);
};
