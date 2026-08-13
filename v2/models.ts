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
import type { Config } from "./config";

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

export type ProviderOption = {
  id: string;
  name: string;
  env: readonly string[];
  connected: boolean;
};

type ModelsDevProvider = {
  name?: string;
  api?: string;
  npm?: string;
  env?: string[];
  models?: Record<
    string,
    {
      id?: string;
      name?: string;
      limit?: { context?: number };
      cost?: { input?: number; output?: number };
      reasoning_options?: Array<{ type?: string; values?: string[] }>;
    }
  >;
};

const catalogUrl = "https://models.dev/api.json";
const azureEnv = ["AZURE_FOUNDRY_API_KEY", "AZURE_API_KEY", "AZURE_OPENAI_API_KEY"];
const supportedProviders = new Set([
  "amazon-bedrock",
  "anthropic",
  "azure",
  "cerebras",
  "cohere",
  "deepseek",
  "google",
  "google-vertex",
  "groq",
  "mistral",
  "openai",
  "openrouter",
  "perplexity",
  "togetherai",
  "xai",
]);
const cloudCredentialEnv: Record<string, readonly string[]> = {
  "amazon-bedrock": [
    "AWS_ACCESS_KEY_ID",
    "AWS_PROFILE",
    "AWS_WEB_IDENTITY_TOKEN_FILE",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
  ],
  "google-vertex": [
    "GOOGLE_APPLICATION_CREDENTIALS",
    "GOOGLE_CLOUD_PROJECT",
    "GOOGLE_VERTEX_PROJECT",
  ],
};

const supported = (id: string, provider: ModelsDevProvider): boolean =>
  supportedProviders.has(id) || provider.npm === "@ai-sdk/openai-compatible";

const credentialsFor = (provider: string, value: ModelsDevProvider): string[] =>
  provider === "azure" ? azureEnv : (value.env ?? []);

const hasEnvironmentCredential = (env: readonly string[]): boolean =>
  env.some((name) => Boolean(process.env[name]));

const isEnvironmentConnected = (provider: string, value: ModelsDevProvider): boolean =>
  hasEnvironmentCredential([
    ...credentialsFor(provider, value),
    ...(cloudCredentialEnv[provider] ?? []),
  ]);

const loadCatalog = async (): Promise<Record<string, ModelsDevProvider>> => {
  const response = await fetch(catalogUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
  return (await response.json()) as Record<string, ModelsDevProvider>;
};

export const modelRef = (value: string, provider = "azure"): ModelRef => {
  const slash = value.indexOf("/");
  return slash < 1
    ? { provider, modelId: value }
    : { provider: value.slice(0, slash), modelId: value.slice(slash + 1) };
};

export const modelLabel = (model: ModelRef): string => `${model.provider}/${model.modelId}`;

export const priceMultiplier = (provider: string): number => {
  const entry = (process.env.GLORIOUS_PRICE_MULTIPLIERS ?? "").split(",").find((item) => {
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

const withPrice = (model: ModelOption): ModelOption => ({
  ...model,
  inputCost:
    model.inputCost === undefined ? undefined : model.inputCost * priceMultiplier(model.provider),
  outputCost:
    model.outputCost === undefined ? undefined : model.outputCost * priceMultiplier(model.provider),
});

const providerSettings = (
  provider: string,
  config?: Config,
): Pick<ModelOption, "region" | "project" | "location"> => {
  const metadata = config?.providers[provider];
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
  return {};
};

const isConfigEnabled = (provider: string, config?: Config): boolean =>
  config?.providers[provider]?.enabled === true;

export const currentModel = (config?: Config): ModelOption => {
  const model = process.env.GLORIOUS_MODEL ?? config?.model.selected ?? "gpt-5.6-luna";
  const ref = modelRef(model);
  return {
    ...ref,
    ...providerSettings(ref.provider, config),
    name: model,
    variant: config?.model.variant,
    env: ref.provider === "azure" ? azureEnv : [],
    npm: ref.provider === "azure" ? "@ai-sdk/azure" : undefined,
  };
};

export const loadProviders = async (config?: Config): Promise<ProviderOption[]> => {
  const catalog = await loadCatalog();
  return Object.entries(catalog)
    .filter(([id, value]) => supported(id, value))
    .map(([id, value]) => {
      const env = credentialsFor(id, value);
      return {
        id,
        name: value.name ?? id,
        env,
        connected: isConfigEnabled(id, config) || isEnvironmentConnected(id, value),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const loadModels = async (
  current: ModelOption,
  config?: Config | string | ((input: RequestInfo | URL, init?: RequestInit) => Promise<Response>),
  provider?: string,
  apiKey?: string,
): Promise<ModelOption[]> => {
  const fetcher = typeof config === "function" ? config : fetch;
  const [resolvedConfig, selectedProvider, selectedApiKey] =
    typeof config === "string"
      ? [undefined, config, provider]
      : typeof config === "function"
        ? [undefined, undefined, undefined]
        : [config, provider, apiKey];
  const response = await fetcher(catalogUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
  const catalog = (await response.json()) as Record<string, ModelsDevProvider>;
  const options = Object.entries(catalog)
    .filter(([id, value]) => {
      if (!supported(id, value)) return false;
      if (selectedProvider) return id === selectedProvider;
      return (
        id === current.provider ||
        isConfigEnabled(id, resolvedConfig) ||
        isEnvironmentConnected(id, value)
      );
    })
    .flatMap(([id, value]) =>
      Object.entries(value.models ?? {}).map(([modelId, model]) => ({
        provider: id,
        ...providerSettings(id, resolvedConfig),
        modelId: model.id ?? modelId,
        name: model.name ?? model.id ?? modelId,
        api: value.api,
        apiKey: id === selectedProvider ? selectedApiKey : undefined,
        env: credentialsFor(id, value),
        npm: value.npm,
        inputCost: model.cost?.input,
        outputCost: model.cost?.output,
        context: model.limit?.context,
        variants: model.reasoning_options?.find((option) => option.type === "effort")?.values,
      })),
    );
  if (selectedProvider) return options.sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
  const currentKey = modelLabel(current);
  const metadata = options.find((option) => modelLabel(option) === currentKey);
  const priced = options.map(withPrice);
  return [
    withPrice({ ...current, ...metadata }),
    ...priced.filter((option) => modelLabel(option) !== currentKey),
  ].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
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
  if (option.npm === "@ai-sdk/openai-compatible") {
    if (!option.api) throw new Error(`No API endpoint is published for ${option.provider}.`);
    return createOpenAICompatible({
      name: option.provider,
      apiKey,
      baseURL: option.api,
      fetch: fetcher as typeof fetch,
    })(option.modelId);
  }
  const factory = factories[option.provider];
  if (!factory) throw new Error(`Provider ${option.provider} is not supported.`);
  return factory({ apiKey, baseURL: option.api, fetch: fetcher as typeof fetch })(option.modelId);
};
