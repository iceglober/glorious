import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateText } from "ai";
import type { Config } from "./config";
import {
  createModel,
  currentModel,
  modelCost,
  modelMetadata,
  NoModelChosen,
  priceMultiplier,
  resolveApiKey,
} from "./models";

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
    delete process.env.GLRS_MODEL;
  });

  // There is no third place to fall back to. Defaulting to azure/gpt-5.6-luna
  // made the most likely provider the one nobody chose, and it was the one
  // branch that dropped `providers.azure.api` — so the guess and the silent
  // misconfiguration compounded.
  test("nothing configured is an error, not a guess", () => {
    expect(() => currentModel()).toThrow(NoModelChosen);
    expect(() => currentModel()).toThrow("No model is configured");
    expect(() => currentModel(config({ model: "   " }))).toThrow("No model is configured");
  });

  test("a model naming no provider is refused, since none is implied", () => {
    expect(() => currentModel(config({ model: "gpt-5.6-luna" }))).toThrow("names no provider");
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

  test("a resolved model carries the names, so the fallback can fire", () => {
    expect(currentModel(config({ model: "anthropic/claude" })).env.length).toBeGreaterThan(0);
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
