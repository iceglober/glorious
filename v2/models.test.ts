import { afterEach, describe, expect, test } from "bun:test";
import type { Config } from "./config";
import { currentModel, loadModels, loadProviders } from "./models";

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
  mcpServers: {},
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
