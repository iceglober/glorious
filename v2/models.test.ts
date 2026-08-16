import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateText } from "ai";
import type { Config } from "./config";
import {
  createModel,
  currentModel,
  loadModels,
  loadProviders,
  modelCost,
  priceMultiplier,
  resolveApiKey,
} from "./models";

describe("model pricing", () => {
  test("reads provider-specific multipliers", () => {
    const previous = process.env.GLORIOUS_PRICE_MULTIPLIERS;
    process.env.GLORIOUS_PRICE_MULTIPLIERS = "azure=1.1, openai=1";
    expect(priceMultiplier("azure")).toBe(1.1);
    expect(priceMultiplier("openai")).toBe(1);
    expect(priceMultiplier("unknown")).toBe(1);
    if (previous === undefined) delete process.env.GLORIOUS_PRICE_MULTIPLIERS;
    else process.env.GLORIOUS_PRICE_MULTIPLIERS = previous;
  });

  test("applies the multiplier to models.dev rates", async () => {
    const previousKey = process.env.AZURE_OPENAI_API_KEY;
    const previousPrices = process.env.GLORIOUS_PRICE_MULTIPLIERS;
    process.env.AZURE_OPENAI_API_KEY = "test";
    process.env.GLORIOUS_PRICE_MULTIPLIERS = "azure=1.1";
    const response = new Response(
      JSON.stringify({
        azure: {
          npm: "@ai-sdk/azure",
          models: { example: { name: "Example", cost: { input: 1, output: 2 } } },
        },
      }),
    );
    const models = await loadModels(
      { provider: "azure", modelId: "other", name: "other", env: [] },
      async () => response,
    );
    expect(models.find((model) => model.modelId === "example")).toMatchObject({
      inputCost: 1.1,
      outputCost: 2.2,
    });
    if (previousKey === undefined) delete process.env.AZURE_OPENAI_API_KEY;
    else process.env.AZURE_OPENAI_API_KEY = previousKey;
    if (previousPrices === undefined) delete process.env.GLORIOUS_PRICE_MULTIPLIERS;
    else process.env.GLORIOUS_PRICE_MULTIPLIERS = previousPrices;
  });

  test("calculates input and output cost per million tokens", () => {
    expect(modelCost({ inputCost: 1.1, outputCost: 2.2 }, 1_000_000, 500_000)).toBe(2.2);
    expect(modelCost({}, 1, 1)).toBeUndefined();
  });
});

const originalFetch = globalThis.fetch;
const environment = [
  "GLORIOUS_MODEL",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "GOOGLE_CLOUD_PROJECT",
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_CLOUD_LOCATION",
  "GOOGLE_VERTEX_LOCATION",
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

const config = (value: Partial<Config> = {}): Config => ({
  model: {},
  providers: {},
  ...value,
});

const catalog = {
  compatible: {
    name: "Compatible API",
    npm: "@ai-sdk/openai-compatible",
    api: "https://example.com/v1",
    env: ["COMPATIBLE_API_KEY"],
    models: { "example-model": { name: "Example model" } },
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
  test("prefers the environment model, then config, then Azure", () => {
    const selected = config({ model: { selected: "anthropic/claude" } });

    expect(currentModel(selected)).toMatchObject({ provider: "anthropic", modelId: "claude" });
    process.env.GLORIOUS_MODEL = "openai/gpt";
    expect(currentModel(selected)).toMatchObject({ provider: "openai", modelId: "gpt" });
    delete process.env.GLORIOUS_MODEL;
    expect(currentModel()).toMatchObject({ provider: "azure", modelId: "gpt-5.6-luna" });
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
      currentModel(
        config({ model: { selected: "amazon-bedrock/model" }, providers: selected.providers }),
      ),
    ).toMatchObject({ region: "eu-west-1" });
    expect(
      currentModel(
        config({ model: { selected: "google-vertex/model" }, providers: selected.providers }),
      ),
    ).toMatchObject({ project: "configured-project", location: "europe-west4" });

    expect(currentModel(config({ model: { selected: "amazon-bedrock/model" } }))).toMatchObject({
      region: "us-west-2",
    });
    expect(currentModel(config({ model: { selected: "google-vertex/model" } }))).toMatchObject({
      project: "environment-project",
      location: "us-central1",
    });
    delete process.env.AWS_REGION;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_LOCATION;
    expect(currentModel(config({ model: { selected: "amazon-bedrock/model" } }))).toMatchObject({
      region: "us-east-1",
    });
    expect(currentModel(config({ model: { selected: "google-vertex/model" } }))).toMatchObject({
      location: "global",
    });
  });
});

describe("models.dev catalog", () => {
  test("lists OpenAI-compatible providers without reading Keychain", async () => {
    mockCatalog();

    expect(await loadProviders()).toEqual([
      {
        id: "compatible",
        name: "Compatible API",
        env: ["COMPATIBLE_API_KEY"],
        connected: false,
      },
    ]);
  });

  test("includes config-enabled providers in normal loading", async () => {
    mockCatalog();
    const selected = config({ providers: { compatible: { enabled: true } } });

    expect(await loadModels(currentModel(selected), selected)).toContainEqual(
      expect.objectContaining({ provider: "compatible", modelId: "example-model" }),
    );
    expect(await loadProviders(selected)).toMatchObject([{ id: "compatible", connected: true }]);
  });

  test("passes an explicitly resolved key to a selected compatible provider", async () => {
    mockCatalog();

    expect(await loadModels(currentModel(), "compatible", "key")).toMatchObject([
      { provider: "compatible", modelId: "example-model", apiKey: "key" },
    ]);
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
    expect(currentModel().env.length).toBeGreaterThan(0);
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
