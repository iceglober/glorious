import type { ModelProvider } from "../../glrs-core/src";

export * from "./config";
export * from "./models";
export * from "./providers";
export * from "./secrets";
export * from "./shaping";

export type CredentialSpec = {
  provider: string;
  environment: readonly string[];
};

/** Model provider plus credential and catalogue metadata. */
export type ProviderAdapter = ModelProvider & {
  credentials: CredentialSpec;
  metadata?: (
    modelId: string,
  ) => Promise<{ context?: number; inputPrice?: number; outputPrice?: number }>;
};

/** Mutable provider lookup used while composing an SDK host. */
export type ProviderRegistry = {
  register: (provider: ProviderAdapter) => void;
  get: (id: string) => ProviderAdapter | undefined;
  list: () => readonly ProviderAdapter[];
};

/** Create an empty provider registry. */
export const createProviderRegistry = (): ProviderRegistry => {
  const providers = new Map<string, ProviderAdapter>();
  return {
    register: (provider) => providers.set(provider.id, provider),
    get: (id) => providers.get(id),
    list: () => [...providers.values()],
  };
};
