import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateText } from "ai";
import type { Config } from "./config";
import {
  chosenModel,
  configuredModel,
  createModel,
  currentModel,
  hydrateModelCredentials,
  modelCost,
  modelMetadata,
  modelsForConnectedProviders,
  priceMultiplier,
  providerConnections,
  registerExtensionProvider,
  resolveApiKey,
} from "./models";
import type { ProviderOptions } from "./shaping";

describe("model pricing", () => {
  test("reads provider-specific multipliers", () => {
    const previous = process.env.GLRS_PRICE_MULTIPLIERS;
    process.env.GLRS_PRICE_MULTIPLIERS = "azure=1.1, openai=1";
    expect(priceMultiplier("azure")).toBe(1.1);
    expect(priceMultiplier("openai")).toBe(1);
    expect(priceMultiplier("unknown")).toBe(1);
    if (previous === undefined) delete process.env.GLRS_PRICE_MULTIPLIERS;
    else process.env.GLRS_PRICE_MULTIPLIERS = previous;
  });

  test("applies the multiplier to models.dev rates", async () => {
    const previous = process.env.GLRS_PRICE_MULTIPLIERS;
    process.env.GLRS_PRICE_MULTIPLIERS = "azure=1.1";
    const response = new Response(
      JSON.stringify({
        azure: {
          npm: "@ai-sdk/azure",
          models: { example: { id: "example", cost: { input: 1, output: 2 } } },
        },
      }),
    );
    const metadata = await modelMetadata(
      { provider: "azure", modelId: "example", name: "example", env: [] },
      (async () => response) as unknown as typeof fetch,
    );
    expect(metadata).toMatchObject({ inputCost: 1.1, outputCost: 2.2 });
    if (previous === undefined) delete process.env.GLRS_PRICE_MULTIPLIERS;
    else process.env.GLRS_PRICE_MULTIPLIERS = previous;
  });

  test("calculates input and output cost per million tokens", () => {
    expect(modelCost({ inputCost: 1.1, outputCost: 2.2 }, 1_000_000, 500_000)).toBe(2.2);
    expect(modelCost({}, 1, 1)).toBeUndefined();
  });
});

const originalFetch = globalThis.fetch;
const environment = [
  "GLRS_MODEL",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_VERTEX_LOCATION",
  "OPENAI_API_KEY",
];
const originalEnvironment = Object.fromEntries(
  environment.map((name) => [name, process.env[name]]),
);

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const name of environment) {
    const value = originalEnvironment[name];
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

const config = (value: Config = {}): Config => value;

const catalog = {
  compatible: {
    name: "Compatible API",
    npm: "@ai-sdk/openai-compatible",
    api: "https://example.com/v1",
    env: ["COMPATIBLE_API_KEY"],
    models: { "example-model": { id: "example-model", limit: { context: 128_000 } } },
  },
  unsupported: {
    name: "Unsupported",
    npm: "@ai-sdk/unsupported",
    models: {},
  },
};

const mockCatalog = (): void => {
  globalThis.fetch = (async () => Response.json(catalog)) as unknown as typeof fetch;
};

describe("model resolution", () => {
  test("prefers the environment model, then config", () => {
    const selected = config({ model: "anthropic/claude" });

    expect(currentModel(selected)).toMatchObject({ provider: "anthropic", modelId: "claude" });
    process.env.GLRS_MODEL = "openai/gpt";
    expect(currentModel(selected)).toMatchObject({ provider: "openai", modelId: "gpt" });
  });

  test("requires an explicitly configured provider and model", () => {
    expect(() => currentModel()).toThrow("No model configured");
    expect(() => currentModel({ model: "gpt-5.6" })).toThrow('Model must be "provider/model-id"');
    expect(() => currentModel({ model: "openai/" })).toThrow('Model must be "provider/model-id"');
  });

  // The TUI opens before a model is chosen, so "nothing is set" is a value it
  // carries rather than a throw it has to catch. `-p` keeps `currentModel`,
  // which has nowhere to ask.
  test("nothing configured is null, not a failure", () => {
    expect(chosenModel()).toBeNull();
    expect(chosenModel({ model: "  " })).toBeNull();
    expect(chosenModel({ model: "anthropic/claude" })).toMatchObject({ provider: "anthropic" });
  });

  // A model that is set and malformed is still a mistake worth reporting. Only
  // an absent one is a state.
  test("a malformed id still throws, whichever way it is asked for", () => {
    expect(() => chosenModel({ model: "gpt-5.6" })).toThrow('Model must be "provider/model-id"');
  });

  test("merges provider defaults with exact model overrides", () => {
    const selected = currentModel(
      config({
        model: "openai/gpt-5",
        providers: {
          openai: {
            factoryOptions: { baseURL: "https://proxy.example/v1", headers: { one: "provider" } },
            requestOptions: { temperature: 0.8, stopSequences: ["provider"] },
            providerOptions: { openai: { store: false, serviceTier: "flex" } },
            models: {
              "gpt-5": {
                requestOptions: { temperature: 0.2, maxOutputTokens: 32000 },
                providerOptions: { openai: { store: true } },
                metadata: { context: 400000, inputCost: 1.25 },
              },
            },
          },
        },
      }),
    );
    expect(selected).toMatchObject({
      factoryOptions: { baseURL: "https://proxy.example/v1", headers: { one: "provider" } },
      requestOptions: { temperature: 0.2, stopSequences: ["provider"], maxOutputTokens: 32000 },
      providerOptions: { openai: { store: true, serviceTier: "flex" } },
      context: 400000,
      inputCost: 1.25,
    });
  });

  test("resolves overrides for a model selected after startup", () => {
    const selected = configuredModel(
      "openai/gpt-6",
      config({
        model: "openai/gpt-5",
        providers: {
          openai: {
            models: {
              "gpt-6": { requestOptions: { temperature: 0.6 } },
            },
          },
        },
      }),
      "high",
    );
    expect(selected).toMatchObject({
      provider: "openai",
      modelId: "gpt-6",
      variant: "high",
      requestOptions: { temperature: 0.6 },
    });
  });

  test("resolves Bedrock and Vertex settings from config and environment", () => {
    const selected = config({
      providers: {
        "amazon-bedrock": { region: "eu-west-1" },
        "google-vertex": { project: "configured-project", location: "europe-west4" },
      },
    });
    process.env.AWS_REGION = "us-west-2";
    process.env.GOOGLE_CLOUD_PROJECT = "environment-project";
    process.env.GOOGLE_CLOUD_LOCATION = "us-central1";

    expect(
      currentModel(config({ model: "amazon-bedrock/model", providers: selected.providers })),
    ).toMatchObject({ region: "eu-west-1" });
    expect(
      currentModel(config({ model: "google-vertex/model", providers: selected.providers })),
    ).toMatchObject({ project: "configured-project", location: "europe-west4" });

    expect(currentModel(config({ model: "amazon-bedrock/model" }))).toMatchObject({
      region: "us-west-2",
    });
    expect(currentModel(config({ model: "google-vertex/model" }))).toMatchObject({
      project: "environment-project",
      location: "us-central1",
    });
    delete process.env.AWS_REGION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    expect(currentModel(config({ model: "amazon-bedrock/model" }))).toMatchObject({
      region: "us-east-1",
    });
    expect(currentModel(config({ model: "google-vertex/model" }))).toMatchObject({
      location: "global",
    });
  });
});

// The picker is gone. What survives is a metadata lookup for the model that is
// already selected, because the status line's percentage needs a denominator.
describe("models.dev metadata", () => {
  test("finds the selected model's context window", async () => {
    mockCatalog();
    expect(
      await modelMetadata({
        provider: "compatible",
        modelId: "example-model",
        name: "example-model",
        env: [],
      }),
    ).toMatchObject({ context: 128_000, api: "https://example.com/v1" });
  });

  test("configured metadata overrides models.dev", async () => {
    mockCatalog();
    expect(
      await modelMetadata({
        provider: "compatible",
        modelId: "example-model",
        name: "example-model",
        env: [],
        context: 999000,
        inputCost: 7,
        variants: ["custom"],
      }),
    ).toMatchObject({ context: 999000, inputCost: 7, variants: ["custom"] });
  });

  test("a model the catalog does not carry yields configured metadata rather than nothing", async () => {
    mockCatalog();
    expect(
      await modelMetadata({
        provider: "azure",
        modelId: "private",
        name: "private",
        env: [],
        context: 64000,
      }),
    ).toEqual({ context: 64000 });
  });

  test("a model the catalog does not carry yields nothing, not a throw", async () => {
    mockCatalog();
    expect(
      await modelMetadata({ provider: "azure", modelId: "private", name: "private", env: [] }),
    ).toEqual({});
  });
});

describe("finding the api key", () => {
  const names = ["AZURE_FOUNDRY_API_KEY", "AZURE_API_KEY", "AZURE_OPENAI_API_KEY"];
  let snapshot: Record<string, string | undefined> = {};

  // Snapshot and restore exactly, every test: another test in this file also
  // saves AZURE_OPENAI_API_KEY, and lazily-captured state made the pair of them
  // order-dependent.
  beforeEach(() => {
    snapshot = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
  });

  afterEach(() => {
    for (const name of names) {
      if (snapshot[name] === undefined) delete process.env[name];
      else process.env[name] = snapshot[name];
    }
  });

  test("an explicit key wins over the environment", () => {
    process.env.AZURE_API_KEY = "from-env";
    expect(resolveApiKey({ apiKey: "explicit", env: names })).toBe("explicit");
  });

  test("it accepts any name the provider answers to, not just the SDK's default", () => {
    // the real report: only AZURE_OPENAI_API_KEY was set, and the SDK reads
    // AZURE_API_KEY, so every session began "Azure OpenAI API key is missing"
    process.env.AZURE_OPENAI_API_KEY = "third-name";
    expect(resolveApiKey({ env: names })).toBe("third-name");
  });

  test("earlier names take precedence", () => {
    process.env.AZURE_API_KEY = "second";
    process.env.AZURE_OPENAI_API_KEY = "third";
    expect(resolveApiKey({ env: names })).toBe("second");
  });

  test("nothing set stays undefined, so the SDK can still raise its own error", () => {
    expect(resolveApiKey({ env: names })).toBeUndefined();
  });

  test("a provider with no declared names is left to the SDK", () => {
    expect(resolveApiKey({ env: [] })).toBeUndefined();
    expect(resolveApiKey({})).toBeUndefined();
  });

  test("the startup model carries the names, so the fallback can fire", () => {
    expect(currentModel({ model: "azure/gpt-4o" }).env.length).toBeGreaterThan(0);
  });
});

describe("configured providers", () => {
  test("hydrates only a model explicitly marked as keychain-backed", async () => {
    let reads = 0;
    const read = async () => {
      reads += 1;
      return "stored-key";
    };
    const bare = { provider: "anthropic", modelId: "claude", name: "Claude", env: [] };
    expect(await hydrateModelCredentials(bare, read)).not.toHaveProperty("apiKey");
    expect(await hydrateModelCredentials({ ...bare, credential: "keychain" }, read)).toHaveProperty(
      "apiKey",
      "stored-key",
    );
    expect(reads).toBe(1);
  });

  test("environment variables and keychain markers count without reading secrets", async () => {
    const connections = await providerConnections(
      {
        providers: {
          anthropic: { credential: "keychain" },
          azure: { credential: "keychain", factoryOptions: { resourceName: "resource" } },
        },
      },
      { OPENAI_API_KEY: "set" },
      "/missing-home",
    );
    const state = Object.fromEntries(connections.map((provider) => [provider.id, provider]));
    expect(state.openai).toMatchObject({ configured: true, source: "environment" });
    expect(state.anthropic).toMatchObject({ configured: true, source: "keychain" });
    expect(state.azure).toMatchObject({ configured: true, source: "keychain" });
  });

  test("ambient Vertex ADC and AWS profiles count as cloud credentials", async () => {
    const home = await mkdtemp(join(tmpdir(), "glrs-provider-home-"));
    await mkdir(join(home, ".config", "gcloud"), { recursive: true });
    await writeFile(join(home, ".config", "gcloud", "application_default_credentials.json"), "{}");
    await mkdir(join(home, ".aws"), { recursive: true });
    await writeFile(join(home, ".aws", "config"), "[default]");
    const connections = await providerConnections(
      { providers: { "google-vertex": { project: "project" } } },
      {},
      home,
    );
    const state = Object.fromEntries(connections.map((provider) => [provider.id, provider]));
    expect(state["google-vertex"]).toMatchObject({ configured: true, source: "cloud" });
    expect(state["amazon-bedrock"]).toMatchObject({ configured: true, source: "cloud" });
    await rm(home, { recursive: true, force: true });
  });

  test("the picker receives models only from configured providers", () => {
    const models = [
      { provider: "anthropic", modelId: "claude", name: "Claude", env: [] },
      { provider: "openai", modelId: "gpt", name: "GPT", env: [] },
    ];
    expect(
      modelsForConnectedProviders(models, [
        { id: "anthropic", label: "Anthropic", configured: true, env: [] },
        { id: "openai", label: "OpenAI", configured: false, env: [] },
      ]).map(({ provider }) => provider),
    ).toEqual(["anthropic"]);
  });

  test("Azure needs both a credential and a resource or endpoint", async () => {
    const withoutResource = await providerConnections(
      { providers: { azure: { credential: "keychain" } } },
      {},
      "/missing-home",
    );
    expect(withoutResource.find(({ id }) => id === "azure")?.configured).toBe(false);
  });
});

describe("extension providers", () => {
  test("a provider may register after the agent has resolved its model", async () => {
    const model = createModel({
      provider: "late-provider",
      modelId: "model",
      name: "late-provider/model",
      env: [],
    });
    let called = false;
    const registration = registerExtensionProvider({
      id: "late-provider",
      create: () =>
        ({
          specificationVersion: "v4",
          provider: "late-provider",
          modelId: "model",
          supportedUrls: {},
          doGenerate: async () => {
            called = true;
            return {
              content: [{ type: "text", text: "from extension" }],
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
              warnings: [],
            };
          },
          doStream: async () => {
            throw new Error("not used");
          },
        }) as never,
    });
    const result = await generateText({ model, prompt: "hi", maxRetries: 0 });
    expect(result.text).toBe("from extension");
    expect(called).toBe(true);
    registration.dispose();
  });
});

describe("Vertex model routing", () => {
  const vertex = (modelId: string) =>
    createModel({
      provider: "google-vertex",
      modelId,
      name: modelId,
      env: [],
      project: "project",
      location: "global",
      factoryOptions: { generateAuthToken: async () => "token" } as never,
    });

  test("Claude uses Vertex's Anthropic adapter and Gemini uses its Google adapter", () => {
    expect(vertex("claude-opus-4-1").provider).toContain("anthropic");
    expect(vertex("gemini-2.5-pro").provider).toContain("google");
  });
});

describe("Azure model routing", () => {
  const requestFor = async (
    modelId: string,
    modelType?: "responses" | "chat" | "deepseek",
    providerOptions: ProviderOptions = {
      azure: { reasoningEffort: "max" },
    },
  ) => {
    let url = "";
    let body: Record<string, unknown> = {};
    const model = createModel(
      {
        provider: "azure",
        modelId,
        name: modelId,
        env: [],
        modelType,
        factoryOptions: { apiKey: "test", baseURL: "https://azure.example/openai" },
      },
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        url = String(input);
        body = JSON.parse(String(init?.body));
        return new Response("{}", { status: 400 });
      }) as typeof fetch,
    );
    await generateText({
      model,
      prompt: "hi",
      maxRetries: 0,
      providerOptions,
    }).catch(() => {});
    return { url, body };
  };

  test("DeepSeek deployments use Azure's DeepSeek chat adapter", async () => {
    const { url, body } = await requestFor("deepseek-v4-flash");
    expect(url).toContain("/chat/completions");
    expect(body.reasoning_effort).toBe("max");
    expect(body).not.toHaveProperty("reasoning");
  });

  test("compaction can use the deployment default without sending an effort", async () => {
    const { url, body } = await requestFor("deepseek-v4-flash", undefined, {});
    expect(url).toContain("/chat/completions");
    expect(body).not.toHaveProperty("reasoning_effort");
    expect(body).not.toHaveProperty("text.verbosity");
  });

  test("ordinary Azure models continue using Responses", async () => {
    const { url, body } = await requestFor("gpt-5.6-luna");
    expect(url).toContain("/responses");
    expect(body).toHaveProperty("reasoning.effort", "max");
    expect(body).not.toHaveProperty("reasoning_effort");
  });

  test("an explicit model type handles private deployment aliases", async () => {
    expect((await requestFor("private-name", "deepseek")).url).toContain("/chat/completions");
    expect((await requestFor("deepseek-named-but-responses", "responses")).url).toContain(
      "/responses",
    );
  });
});

describe("provider factory passthrough", () => {
  test("an explicitly configured factory API key overrides the environment", async () => {
    process.env.OPENAI_API_KEY = "environment-key";
    const sent: { authorization: string | null } = { authorization: null };
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent.authorization = new Headers(init?.headers).get("authorization");
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const model = createModel(
      {
        provider: "openai",
        modelId: "gpt-5",
        name: "gpt-5",
        env: ["OPENAI_API_KEY"],
        factoryOptions: { apiKey: "configured-key" },
      },
      fetcher,
    );
    await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(() => {});
    expect(sent.authorization).toBe("Bearer configured-key");
  });

  test("base URL and arbitrary headers reach the provider request", async () => {
    let url = "";
    let headers = new Headers();
    const fetcher = (async (input: RequestInfo | URL, init?: RequestInit) => {
      url = String(input);
      headers = new Headers(init?.headers);
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const model = createModel(
      {
        provider: "openai",
        modelId: "gpt-5",
        name: "gpt-5",
        env: [],
        factoryOptions: {
          apiKey: "test-key",
          baseURL: "https://proxy.example/custom/v1",
          headers: { "x-provider-option": "passed" },
        },
      },
      fetcher,
    );
    await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(() => {});
    expect(url).toStartWith("https://proxy.example/custom/v1/");
    expect(headers.get("x-provider-option")).toBe("passed");
  });
});

describe("the key createModel actually sends", () => {
  const names = ["AZURE_FOUNDRY_API_KEY", "AZURE_API_KEY", "AZURE_OPENAI_API_KEY"];
  let snapshot: Record<string, string | undefined> = {};

  beforeEach(() => {
    snapshot = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    for (const name of names) delete process.env[name];
  });

  afterEach(() => {
    for (const name of names) {
      if (snapshot[name] === undefined) delete process.env[name];
      else process.env[name] = snapshot[name];
    }
  });

  // Asserting on resolveApiKey alone leaves createModel free to ignore it, which
  // is exactly the wiring that was broken.
  const headerFor = async (): Promise<string | null> => {
    let sent: Headers | undefined;
    const fetcher = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      sent = new Headers(init?.headers);
      return new Response("{}", { status: 500 });
    }) as typeof fetch;
    const model = createModel(
      {
        provider: "azure",
        modelId: "gpt-4o",
        name: "gpt-4o",
        env: names,
        npm: "@ai-sdk/azure",
      },
      fetcher,
    );
    await generateText({ model, prompt: "hi", maxRetries: 0 }).catch(() => {});
    return sent?.get("api-key") ?? null;
  };

  test("it sends a key found under any of the provider's names", async () => {
    process.env.AZURE_OPENAI_API_KEY = "third-name";
    process.env.AZURE_RESOURCE_NAME = "example";
    expect(await headerFor()).toBe("third-name");
  });
});
