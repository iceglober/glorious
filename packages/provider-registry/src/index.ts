/** @module Providers */
import type { ModelProvider } from "../../glorious-core/src";

export * from "./config";
export * from "./models";
export * from "./providers";

export type CredentialSpec = {
  provider: string;
  environment: readonly string[];
};

export type ProviderAdapter = ModelProvider & {
  credentials: CredentialSpec;
  metadata?: (
    modelId: string,
  ) => Promise<{ context?: number; inputPrice?: number; outputPrice?: number }>;
};

export type ProviderRegistry = {
  register: (provider: ProviderAdapter) => void;
  get: (id: string) => ProviderAdapter | undefined;
  list: () => readonly ProviderAdapter[];
};

export const createProviderRegistry = (): ProviderRegistry => {
  const providers = new Map<string, ProviderAdapter>();
  return {
    register: (provider) => providers.set(provider.id, provider),
    get: (id) => providers.get(id),
    list: () => [...providers.values()],
  };
};
