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
export const modelRef = (value: string, provider = "azure"): ModelRef => {
  const slash = value.indexOf("/");
  return slash < 1
    ? { provider: canonicalProvider(provider), modelId: value }
    : {
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

const providerSettings = (
  provider: string,
  config?: Config,
): Pick<ModelOption, "api" | "region" | "project" | "location"> => {
  const metadata = config?.providers?.[provider];
  if (provider === "amazon-bedrock")
    return {
      region:
        metadata?.region ?? process.env.AWS_REGION ?? process.env.AWS_DEFAULT_REGION ?? "us-east-1",
    };
  if (provider === "google-vertex")
    return {
      project:
        metadata?.project ?? process.env.GOOGLE_CLOUD_PROJECT ?? process.env.GOOGLE_VERTEX_PROJECT,
      location:
        metadata?.location ??
        process.env.GOOGLE_CLOUD_LOCATION ??
        process.env.GOOGLE_VERTEX_LOCATION ??
        "global",
    };
  return metadata?.api === undefined ? {} : { api: metadata.api };
};

export const currentModel = (config?: Config): ModelOption => {
  const model = envSetting("MODEL") ?? config?.model ?? "gpt-5.6-luna";
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
  if (option.provider === "azure" || option.npm === "@ai-sdk/azure")
    return createAzure({ apiKey, fetch: fetcher as typeof fetch })(option.modelId);
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
