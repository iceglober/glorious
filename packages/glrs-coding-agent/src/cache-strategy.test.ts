import { describe, expect, test } from "bun:test";
import { generateText } from "ai";
import {
  createModel,
  type ModelOption,
  registerExtensionProvider,
} from "../../provider-registry/src";
import { cacheOwnerFor, requestSettings } from "./agent";

type EndpointCase = {
  name: string;
  model: ModelOption;
  path: string;
  cacheKey: boolean;
};

const base = {
  name: "test",
  env: [],
  factoryOptions: { apiKey: "test", baseURL: "https://provider.example/v1" },
} as const;

const endpointCases: EndpointCase[] = [
  {
    name: "OpenAI Responses",
    model: { ...base, provider: "openai", modelId: "gpt-5" },
    path: "/responses",
    cacheKey: true,
  },
  {
    name: "Azure Responses",
    model: { ...base, provider: "azure", modelId: "gpt-5", modelType: "responses" },
    path: "/responses",
    cacheKey: true,
  },
  {
    name: "Azure Chat",
    model: { ...base, provider: "azure", modelId: "gpt-4o", modelType: "chat" },
    path: "/chat/completions",
    cacheKey: true,
  },
  {
    name: "Azure DeepSeek",
    model: { ...base, provider: "azure", modelId: "deepseek-v4", modelType: "deepseek" },
    path: "/chat/completions",
    cacheKey: false,
  },
  {
    name: "OpenAI-compatible Chat",
    model: { ...base, provider: "local", modelId: "model" },
    path: "/chat/completions",
    cacheKey: false,
  },
];

const outgoingRequest = async (selected: ModelOption) => {
  let url = "";
  let body: Record<string, unknown> = {};
  const model = createModel(selected, (async (input: RequestInfo | URL, init?: RequestInit) => {
    url = String(input);
    body = JSON.parse(String(init?.body));
    return new Response("{}", { status: 400 });
  }) as typeof fetch);
  await generateText({
    model,
    prompt: "cache this stable prefix",
    maxRetries: 0,
    ...requestSettings(selected, "stable-cache-key", cacheOwnerFor(selected.provider)),
  }).catch(() => {});
  return { url, body };
};

describe("cache strategy reaches every built-in endpoint adapter", () => {
  for (const endpoint of endpointCases)
    test(endpoint.name, async () => {
      const request = await outgoingRequest(endpoint.model);
      expect(new URL(request.url).pathname).toEndWith(endpoint.path);
      if (endpoint.cacheKey) expect(request.body.prompt_cache_key).toBe("stable-cache-key");
      else expect(request.body).not.toHaveProperty("prompt_cache_key");
    });
});

describe("extension provider cache ownership", () => {
  test("registered providers receive no glrs cache key", () => {
    const registration = registerExtensionProvider({
      id: "custom",
      create: () => {
        throw new Error("not called");
      },
    });
    try {
      expect(cacheOwnerFor("custom")).toBe("extension");
      expect(
        requestSettings(
          { provider: "custom", modelId: "model" },
          "stable-cache-key",
          cacheOwnerFor("custom"),
        ),
      ).not.toHaveProperty("providerOptions.openaiCompatible.promptCacheKey");
    } finally {
      registration.dispose();
    }
  });

  test("unregistered compatible endpoints remain glrs-managed", () => {
    expect(cacheOwnerFor("compatible-endpoint")).toBe("glrs");
  });
});
