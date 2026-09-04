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
import type { ExtensionProvider } from "../../glrs-core/src";
import {
  type AzureModelType,
  type Config,
  envSetting,
  type JsonObject,
  type ModelSettings,
} from "./config";
import { canonicalProvider, nearestProvider, providerSpec } from "./providers";

export { PROVIDER_SETTINGS, settingsFor } from "./providers";

type ResolvedLanguageModel = Extract<LanguageModel, { specificationVersion: "v4" }>;

export type ModelRef = {
  provider: string;
  modelId: string;
};

export class NoModelChosen extends Error {}

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
  modelType?: AzureModelType;
  factoryOptions?: JsonObject;
  requestOptions?: JsonObject;
  providerOptions?: Record<string, JsonObject>;
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
export const modelRef = (value: string): ModelRef => {
  const slash = value.indexOf("/");
  if (slash < 1 || slash === value.length - 1)
    throw new NoModelChosen(`Model must be "provider/model-id", got "${value}".`);
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

const mergeObjects = <T extends JsonObject>(
  far: T | undefined,
  near: T | undefined,
): T | undefined => {
  if (far === undefined) return near;
  if (near === undefined) return far;
  const output: JsonObject = { ...far };
  for (const [key, value] of Object.entries(near))
    output[key] =
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (mergeObjects(
            typeof output[key] === "object" && output[key] !== null && !Array.isArray(output[key])
              ? (output[key] as JsonObject)
              : undefined,
            value as JsonObject,
          ) ?? {})
        : value;
  return output as T;
};

const modelSettings = (
  provider: string,
  modelId: string,
  config?: Config,
): ModelSettings | undefined => config?.providers?.[provider]?.models?.[modelId];

const providerSettings = (
  provider: string,
  modelId: string,
  config?: Config,
): Partial<
  Pick<
    ModelOption,
    | "api"
    | "region"
    | "project"
    | "location"
    | "factoryOptions"
    | "modelType"
    | "requestOptions"
    | "providerOptions"
    | "name"
    | "context"
    | "inputCost"
    | "outputCost"
    | "variants"
  >
> => {
  const providerSettings = config?.providers?.[provider];
  const model = modelSettings(provider, modelId, config);
  const metadata = model?.metadata;
  const common = {
    api: providerSettings?.api,
    factoryOptions: providerSettings?.factoryOptions,
    modelType: model?.modelType,
    requestOptions: mergeObjects(providerSettings?.requestOptions, model?.requestOptions),
    providerOptions: mergeObjects(
      providerSettings?.providerOptions as JsonObject | undefined,
      model?.providerOptions as JsonObject | undefined,
    ) as Record<string, JsonObject> | undefined,
    name: metadata?.name,
    context: metadata?.context,
    inputCost: metadata?.inputCost,
    outputCost: metadata?.outputCost,
    variants: metadata?.variants,
  };
  if (provider === "amazon-bedrock")
    return {
      ...common,
      region:
        providerSettings?.region ??
        process.env.AWS_REGION ??
        process.env.AWS_DEFAULT_REGION ??
        "us-east-1",
    };
  if (provider === "google-vertex")
    return {
      ...common,
      project:
        providerSettings?.project ??
        process.env.GOOGLE_CLOUD_PROJECT ??
        process.env.GOOGLE_VERTEX_PROJECT,
      location:
        providerSettings?.location ??
        process.env.GOOGLE_CLOUD_LOCATION ??
        process.env.GOOGLE_VERTEX_LOCATION ??
        "global",
    };
  return common;
};

export const configuredModel = (
  value: string,
  config?: Config,
  variant: string | undefined = config?.variant,
): ModelOption => {
  const model = value.trim();
  const ref = modelRef(model);
  const settings = providerSettings(ref.provider, ref.modelId, config);
  return {
    ...ref,
    ...settings,
    name: settings.name ?? model,
    variant,
    // From the provider table, so every provider declares its own names rather
    // than azure being special-cased and the rest falling through to whatever
    // their SDK happens to read.
    env: providerSpec(ref.provider)?.env ?? [],
    npm: ref.provider === "azure" ? "@ai-sdk/azure" : undefined,
  };
};

// Null, not an exception: a session opens before a model is chosen, so "nothing
// is set yet" is a state the TUI carries rather than a failure. `currentModel`
// below is the same lookup for the callers that have no way to ask.
export const chosenModel = (config?: Config): ModelOption | null => {
  const model = (envSetting("MODEL") ?? config?.model)?.trim();
  if (!model) return null;
  return configuredModel(model, config, envSetting("VARIANT") ?? config?.variant);
};

// For `-p` and anything else running without a terminal to ask at. There is no
// default model and never was; what changed is that the TUI no longer treats
// its absence as fatal.
export const currentModel = (config?: Config): ModelOption => {
  const chosen = chosenModel(config);
  if (chosen === null)
    throw new NoModelChosen(
      'No model configured. Set GLRS_MODEL="provider/model-id" or add "model" to glrs config.',
    );
  return chosen;
};

// Every model the catalogue carries, behind `g.models()`. The core does not use
// it: choosing a model is not a core capability, so the list exists for whatever
// extension does the choosing. `model-picker` is the one that ships.
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

// Context window and per-token pricing for a model that has already been chosen.
// A metadata lookup, not a catalogue: the status line says `ctx 12.3k(6%)` and
// the percentage needs a denominator. One request, silent when it fails, and
// offline the status line reads `unknown` while everything else works.
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
  const configured = Object.fromEntries(
    (["api", "npm", "context", "inputCost", "outputCost", "variants"] as const)
      .map((key) => [key, model[key]])
      .filter(([, value]) => value !== undefined),
  ) as Partial<ModelOption>;
  const provider = catalog[model.provider];
  const entry = Object.values(provider?.models ?? {}).find(
    (candidate) => (candidate.id ?? "") === model.modelId,
  );
  if (!entry) return configured;
  const scale = priceMultiplier(model.provider);
  return {
    api: provider?.api,
    npm: provider?.npm,
    context: entry.limit?.context,
    inputCost: entry.cost?.input === undefined ? undefined : entry.cost.input * scale,
    outputCost: entry.cost?.output === undefined ? undefined : entry.cost.output * scale,
    variants: entry.reasoning_options?.find((option) => option.type === "effort")?.values,
    ...configured,
  };
};

type ProviderFactory = (options?: Record<string, unknown>) => (id: string) => ResolvedLanguageModel;

const extensionProviders = new Map<string, ExtensionProvider>();

export const registerExtensionProvider = (provider: ExtensionProvider): { dispose: () => void } => {
  if (extensionProviders.has(provider.id)) return { dispose: () => {} };
  extensionProviders.set(provider.id, provider);
  return {
    dispose: () => {
      if (extensionProviders.get(provider.id) === provider) extensionProviders.delete(provider.id);
    },
  };
};

const lateExtensionModel = (option: ModelOption): ResolvedLanguageModel => {
  const resolved = (): ResolvedLanguageModel => {
    const provider = extensionProviders.get(option.provider);
    if (!provider)
      throw new Error(
        `Provider "${option.provider}" has not registered yet. Load an extension that calls g.provider().`,
      );
    return provider.create(option.modelId, option.factoryOptions);
  };
  return {
    specificationVersion: "v4",
    modelId: option.modelId,
    get provider() {
      return resolved().provider;
    },
    get supportedUrls() {
      return resolved().supportedUrls;
    },
    doGenerate: (settings) => resolved().doGenerate(settings),
    doStream: (settings) => resolved().doStream(settings),
  } as ResolvedLanguageModel;
};

// `/openai/v1` is the OpenAI-compatible chat surface on a Foundry resource, as
// distinct from `/openai/deployments/...` which is the Azure OpenAI one.
export const foundryUrl = (resource: string): string =>
  `https://${resource}.openai.azure.com/openai/v1`;

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
// to three, but each SDK falls back to exactly one. `missingFor` reports a
// provider as connected on any of them, so resolving the same list here is what
// keeps what a picker shows and what a call actually reaches in agreement.
export const resolveApiKey = (option: {
  apiKey?: string;
  env?: readonly string[];
}): string | undefined =>
  option.apiKey ?? option.env?.map((name) => process.env[name]).find((value) => Boolean(value));

export const createModel = (
  option: ModelOption,
  fetcher: typeof fetch = fetch,
): ResolvedLanguageModel => {
  const extension = extensionProviders.get(option.provider);
  if (extension)
    return extension.create(option.modelId, {
      ...(option.factoryOptions ?? {}),
      fetch: fetcher,
    });
  const configured = { ...(option.factoryOptions ?? {}) } as Record<string, unknown>;
  const configuredKey = typeof configured.apiKey === "string" ? configured.apiKey : undefined;
  const apiKey = configuredKey ?? resolveApiKey(option);
  const common = {
    ...configured,
    ...(option.api !== undefined && configured.baseURL === undefined
      ? { baseURL: option.api }
      : {}),
    ...(apiKey !== undefined ? { apiKey } : {}),
    // The wrapped fetch carries deadlines and extension lifecycle hooks, so it
    // is the one provider factory option config cannot replace.
    fetch: fetcher as typeof fetch,
  };
  if (option.provider === "azure" || option.npm === "@ai-sdk/azure") {
    const provider = createAzure(common as Parameters<typeof createAzure>[0]);
    const modelType =
      option.modelType ??
      (option.modelId.toLowerCase().includes("deepseek") ? "deepseek" : "responses");
    return provider[modelType](option.modelId);
  }
  // A Foundry resource hosts other vendors' models behind an OpenAI-shaped chat
  // endpoint. Two things stop the generic compatible path reaching one: the base
  // URL has to be derived from the resource, and Azure authenticates with an
  // `api-key` header rather than a bearer token. Both are known here, so this
  // needs no config at all.
  if (option.provider === "azure-foundry") {
    const resource = process.env.AZURE_RESOURCE_NAME;
    const base = option.api ?? (resource === undefined ? undefined : foundryUrl(resource));
    if (base === undefined)
      throw new Error(
        "azure-foundry needs AZURE_RESOURCE_NAME, or providers.azure-foundry.api for a resource glrs cannot name.",
      );
    return createOpenAICompatible({
      ...common,
      name: "azure-foundry",
      baseURL: base,
      headers: {
        ...(apiKey === undefined ? {} : { "api-key": apiKey }),
        ...((configured.headers as Record<string, string> | undefined) ?? {}),
      },
    } as Parameters<typeof createOpenAICompatible>[0])(option.modelId);
  }
  if (option.provider === "amazon-bedrock")
    return createAmazonBedrock({
      ...common,
      ...(option.region !== undefined && configured.region === undefined
        ? { region: option.region }
        : {}),
    } as Parameters<typeof createAmazonBedrock>[0])(option.modelId);
  if (option.provider === "google-vertex")
    return createGoogleVertex({
      ...common,
      ...(option.project !== undefined && configured.project === undefined
        ? { project: option.project }
        : {}),
      ...(option.location !== undefined && configured.location === undefined
        ? { location: option.location }
        : {}),
    } as Parameters<typeof createGoogleVertex>[0])(option.modelId);
  const factory = factories[option.provider];
  // Anything without a factory of its own is an OpenAI-compatible endpoint —
  // Ollama, LM Studio, vLLM, a gateway, a company proxy. It only needs a base
  // URL, which is the one thing that cannot be guessed. Previously this was
  // reachable only if models.dev happened to publish the provider, so a local
  // server could not be used at all.
  if (option.npm === "@ai-sdk/openai-compatible" || !factory) {
    if (!option.api && typeof configured.baseURL !== "string") {
      const near = nearestProvider(option.provider);
      if (near === undefined) return lateExtensionModel(option);
      throw new Error(`Unknown provider "${option.provider}", did you mean "${near}"?`);
    }
    return createOpenAICompatible({
      name: option.provider,
      ...common,
    } as Parameters<typeof createOpenAICompatible>[0])(option.modelId);
  }
  return factory(common)(option.modelId);
};
