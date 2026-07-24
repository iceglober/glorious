import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock";
import { createAnthropic } from "@ai-sdk/anthropic";
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
import type { LanguageModel } from "ai";
import { GoogleAuth, gaxios } from "google-auth-library";
import z from "zod";
import {
  type AzureModelConfig,
  azureModelConfigSchema,
  createAzureModelProvider,
  fetchWithRequestDeadline,
} from "./azure-adapter";
import { type CloudSessionResult, describeAuthError } from "./cloud-auth";

/** A model constructor bound to one provider's auth; each factory returns one. */
export type ModelFactory = (modelId: string) => LanguageModel;

// Every provider shares one request deadline + retry (see azure-adapter). Bun's
// fetch type adds `preconnect`, unused here — assert at the vendor boundary.
const DEADLINE_FETCH = fetchWithRequestDeadline as unknown as typeof fetch;

/**
 * Most `@ai-sdk/*` providers share one shape: `createX({ apiKey?, baseURL? })`
 * returns a callable `provider(modelId)`. The SDK reads the provider's own env
 * var (OPENAI_API_KEY, …) when apiKey is absent, so config stays optional.
 */
export const keyProviderConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().url().optional(),
});
export type KeyProviderConfig = z.infer<typeof keyProviderConfigSchema>;

// The vendor create fns have provider-specific return types that are all
// callable ModelFactories; unify them at this boundary.
type VendorCreate = (opts: {
  apiKey?: string;
  baseURL?: string;
  fetch?: typeof fetch;
}) => ModelFactory;

const keyBased =
  (create: VendorCreate) =>
  (config: KeyProviderConfig = {}): ModelFactory =>
  (modelId) =>
    create({ apiKey: config.apiKey, baseURL: config.baseURL, fetch: DEADLINE_FETCH })(modelId);

const asVendor = (create: unknown): VendorCreate => create as VendorCreate;

// --- Special-auth providers ---------------------------------------------------

/** OpenAI-compatible endpoint (OpenRouter, Ollama, vLLM, …): needs a base URL. */
export const openAICompatibleConfigSchema = z.object({
  apiKey: z.string().optional(),
  baseURL: z.string().url().optional(),
  /** Provider label sent to the endpoint; defaults to `openai-compatible`. */
  name: z.string().optional(),
});
export type OpenAICompatibleConfig = z.infer<typeof openAICompatibleConfigSchema>;

const createOpenAICompatibleProvider =
  (config: OpenAICompatibleConfig = {}): ModelFactory =>
  (modelId) => {
    if (!config.baseURL)
      throw new Error(
        "openai-compatible provider needs a base URL: set agent.llm.providers.openai-compatible.baseURL.",
      );
    return createOpenAICompatible({
      name: config.name ?? "openai-compatible",
      baseURL: config.baseURL,
      apiKey: config.apiKey,
      fetch: DEADLINE_FETCH,
    })(modelId);
  };

/** AWS Bedrock: an API key, or the standard AWS credential chain (env/profile). */
export const bedrockConfigSchema = z.object({
  apiKey: z.string().optional(),
  region: z.string().optional(),
  accessKeyId: z.string().optional(),
  secretAccessKey: z.string().optional(),
  sessionToken: z.string().optional(),
  baseURL: z.string().url().optional(),
});
export type BedrockConfig = z.infer<typeof bedrockConfigSchema>;

const envPick = (
  env: Record<string, string | undefined>,
  ...names: string[]
): string | undefined => {
  for (const n of names) {
    const v = env[n]?.trim();
    if (v) return v;
  }
  return undefined;
};

/** Resolve Bedrock's region: config → AWS_REGION/AWS_DEFAULT_REGION → us-east-1.
 *  The SDK needs a region; supplying a default beats crashing at first call. */
export const resolveBedrockRegion = (
  config: BedrockConfig,
  env: Record<string, string | undefined> = process.env,
): string => config.region ?? envPick(env, "AWS_REGION", "AWS_DEFAULT_REGION") ?? "us-east-1";

const createBedrockProvider =
  (config: BedrockConfig = {}): ModelFactory =>
  (modelId) =>
    asVendor(createAmazonBedrock)({
      ...config,
      region: resolveBedrockRegion(config),
      fetch: DEADLINE_FETCH,
    } as never)(modelId);

/** Google Vertex: project + location, authenticated via Application Default Credentials. */
export const vertexConfigSchema = z.object({
  project: z.string().optional(),
  location: z.string().optional(),
  baseURL: z.string().url().optional(),
});
export type VertexConfig = z.infer<typeof vertexConfigSchema>;

/** Resolve Vertex's project + location from config → env → a default location.
 *  The SDK hard-errors when the location is absent (even with valid ADC), so a
 *  provider connected purely via detected credentials still works out of the
 *  box. Defaults to `global`: the newest Gemini models are served there and not
 *  from regional endpoints, so a regional default breaks the common case. */
export const resolveVertexSettings = (
  config: VertexConfig,
  env: Record<string, string | undefined> = process.env,
): { location: string; project?: string } => {
  const location =
    config.location ?? envPick(env, "GOOGLE_VERTEX_LOCATION", "GOOGLE_CLOUD_REGION") ?? "global";
  const project = config.project ?? envPick(env, "GOOGLE_VERTEX_PROJECT", "GOOGLE_CLOUD_PROJECT");
  return { location, ...(project ? { project } : {}) };
};

/** Probe Vertex's live session by fetching an access token via ADC. Distinguishes
 *  a re-auth-required session (stale) from absent credentials (missing), so the
 *  config TUI can validate before you pick a Vertex model. */
export const validateVertexSession = async (
  config: VertexConfig = {},
): Promise<CloudSessionResult> => {
  try {
    const { project } = resolveVertexSettings(config);
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      clientOptions: { transporter: new gaxios.Gaxios({ fetchImplementation: DEADLINE_FETCH }) },
      ...(project ? { projectId: project } : {}),
    });
    const client = await auth.getClient();
    const token = await client.getAccessToken();
    return token?.token ? "valid" : "missing";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A recognized re-auth error → stale (a login fixes it); anything else
    // (no ADC, bad config) → missing.
    return describeAuthError(message) ? "stale" : "missing";
  }
};

const createVertexProvider =
  (config: VertexConfig = {}): ModelFactory =>
  (modelId) =>
    asVendor(createGoogleVertex)({
      ...config,
      ...resolveVertexSettings(config),
      // Vertex's ADC token fetch runs through google-auth-library's gaxios,
      // which prefers `node-fetch` and finds none under Bun ("fetchImpl is not a
      // function"). Give the auth client a transporter bound to our fetch so the
      // token request uses Bun's fetch instead of the missing node-fetch.
      googleAuthOptions: {
        clientOptions: { transporter: new gaxios.Gaxios({ fetchImplementation: DEADLINE_FETCH }) },
      },
      fetch: DEADLINE_FETCH,
    } as never)(modelId);

// --- Registry -----------------------------------------------------------------

/** Per-provider connection/auth settings — each provider's config shape. */
export interface ProviderConfigs {
  azure: AzureModelConfig;
  openai: KeyProviderConfig;
  anthropic: KeyProviderConfig;
  google: KeyProviderConfig;
  mistral: KeyProviderConfig;
  cohere: KeyProviderConfig;
  groq: KeyProviderConfig;
  deepseek: KeyProviderConfig;
  xai: KeyProviderConfig;
  togetherai: KeyProviderConfig;
  cerebras: KeyProviderConfig;
  perplexity: KeyProviderConfig;
  "openai-compatible": OpenAICompatibleConfig;
  bedrock: BedrockConfig;
  vertex: VertexConfig;
}

export type ProviderName = keyof ProviderConfigs;

/** Registry keyed by `llm.provider`. Declaration order is the display order. */
export const llmProviders: {
  [K in ProviderName]: (config?: ProviderConfigs[K]) => ModelFactory;
} = {
  azure: createAzureModelProvider,
  openai: keyBased(asVendor(createOpenAI)),
  anthropic: keyBased(asVendor(createAnthropic)),
  google: keyBased(asVendor(createGoogle)),
  mistral: keyBased(asVendor(createMistral)),
  cohere: keyBased(asVendor(createCohere)),
  groq: keyBased(asVendor(createGroq)),
  deepseek: keyBased(asVendor(createDeepSeek)),
  xai: keyBased(asVendor(createXai)),
  togetherai: keyBased(asVendor(createTogetherAI)),
  cerebras: keyBased(asVendor(createCerebras)),
  perplexity: keyBased(asVendor(createPerplexity)),
  "openai-compatible": createOpenAICompatibleProvider,
  bedrock: createBedrockProvider,
  vertex: createVertexProvider,
};

/** Provider names; the config `provider` enum derives from here. */
export const providerNames = Object.keys(llmProviders) as [ProviderName, ...ProviderName[]];

/** The `agent.llm.providers` schema: every provider's config, all optional. */
export const providersConfigSchema = z.object({
  azure: azureModelConfigSchema.optional(),
  openai: keyProviderConfigSchema.optional(),
  anthropic: keyProviderConfigSchema.optional(),
  google: keyProviderConfigSchema.optional(),
  mistral: keyProviderConfigSchema.optional(),
  cohere: keyProviderConfigSchema.optional(),
  groq: keyProviderConfigSchema.optional(),
  deepseek: keyProviderConfigSchema.optional(),
  xai: keyProviderConfigSchema.optional(),
  togetherai: keyProviderConfigSchema.optional(),
  cerebras: keyProviderConfigSchema.optional(),
  perplexity: keyProviderConfigSchema.optional(),
  "openai-compatible": openAICompatibleConfigSchema.optional(),
  bedrock: bedrockConfigSchema.optional(),
  vertex: vertexConfigSchema.optional(),
});

/**
 * Providers whose only credential is an API key stored in the keychain
 * (`config set --secret providers.<name>.apiKey`). Bedrock and Vertex use their
 * cloud credential chains, so they're excluded from the key-entry flow.
 */
export const KEY_PROVIDERS: readonly ProviderName[] = [
  "azure",
  "openai",
  "anthropic",
  "google",
  "mistral",
  "cohere",
  "groq",
  "deepseek",
  "xai",
  "togetherai",
  "cerebras",
  "perplexity",
  "openai-compatible",
];
