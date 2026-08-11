import { createAzure } from "@ai-sdk/azure";
import { createOpenAI } from "@ai-sdk/openai";

export type ModelRef = {
  provider: string;
  modelId: string;
};

export type ModelOption = ModelRef & {
  name: string;
  api?: string;
  env: readonly string[];
  npm?: string;
  inputCost?: number;
  outputCost?: number;
  context?: number;
  variants?: readonly string[];
  variant?: string;
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

export const currentModel = (): ModelOption => {
  const model = process.env.GLORIOUS_MODEL ?? "gpt-5.6-luna";
  return { ...modelRef(model), name: model, env: [] };
};

export const loadModels = async (
  current: ModelOption,
  fetcher: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response> = fetch,
): Promise<ModelOption[]> => {
  const response = await fetcher(catalogUrl, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
  const data = (await response.json()) as Record<string, ModelsDevProvider>;
  const options = Object.entries(data).flatMap(([provider, value]) => {
    const env = value.env ?? [];
    const credentials =
      provider === "azure"
        ? ["AZURE_FOUNDRY_API_KEY", "AZURE_API_KEY", "AZURE_OPENAI_API_KEY", "AZURE_RESOURCE_NAME"]
        : env;
    if (!credentials.some((key) => process.env[key])) return [];
    if (
      value.npm !== "@ai-sdk/openai" &&
      value.npm !== "@ai-sdk/openai-compatible" &&
      value.npm !== "@ai-sdk/azure"
    )
      return [];
    return Object.entries(value.models ?? {}).map(([modelId, model]) => ({
      provider,
      modelId: model.id ?? modelId,
      name: model.name ?? model.id ?? modelId,
      api: value.api,
      env: provider === "azure" || value.npm === "@ai-sdk/azure" ? credentials : env,
      npm: value.npm,
      inputCost: model.cost?.input,
      outputCost: model.cost?.output,
      context: model.limit?.context,
      variants: model.reasoning_options?.find((option) => option.type === "effort")?.values,
    }));
  });
  const priced = options.map(withPrice);
  const currentKey = modelLabel(current);
  const metadata = priced.find((option) => modelLabel(option) === currentKey);
  return [
    withPrice({ ...current, ...metadata }),
    ...priced.filter((option) => modelLabel(option) !== currentKey),
  ].sort((a, b) => modelLabel(a).localeCompare(modelLabel(b)));
};

export const createModel = (option: ModelOption, fetcher: typeof fetch = fetch) => {
  if (option.provider === "azure" || option.npm === "@ai-sdk/azure") {
    const apiKey =
      process.env.AZURE_FOUNDRY_API_KEY ||
      process.env.AZURE_API_KEY ||
      process.env.AZURE_OPENAI_API_KEY;
    if (!apiKey)
      throw new Error(
        "Azure API key missing: set AZURE_FOUNDRY_API_KEY, AZURE_API_KEY, or AZURE_OPENAI_API_KEY.",
      );
    return createAzure({ apiKey, fetch: fetcher as typeof fetch })(option.modelId);
  }
  const apiKey = option.env.map((key) => process.env[key]).find(Boolean);
  if (!apiKey) throw new Error(`API key missing for ${option.provider}.`);
  if (!option.api) throw new Error(`No API endpoint is published for ${option.provider}.`);
  return createOpenAI({ apiKey, baseURL: option.api, fetch: fetcher as typeof fetch })(
    option.modelId,
  );
};
