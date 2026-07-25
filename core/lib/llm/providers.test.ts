import { describe, expect, test } from "bun:test";
import {
  KEY_PROVIDERS,
  llmProviders,
  providerNames,
  providersConfigSchema,
  resolveBedrockRegion,
  resolveVertexSettings,
} from "./providers";

describe("provider registry", () => {
  test("registers every AI SDK provider we support", () => {
    expect(providerNames).toEqual([
      "azure",
      "openai",
      "anthropic",
      "claude",
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
      "bedrock",
      "vertex",
    ]);
  });

  test("every provider instantiates a language model from config", () => {
    const config = {
      apiKey: "sk-test",
      baseURL: "https://api.example.com/v1",
      name: "compat",
      region: "us-east-1",
      project: "proj",
      location: "us-central1",
    };
    for (const name of providerNames) {
      const factory = llmProviders[name] as (c?: typeof config) => (id: string) => unknown;
      const model = factory(config)("some-model");
      expect(model, `${name} should build a model`).toBeTruthy();
    }
  });

  test("openai-compatible requires a base URL", () => {
    expect(() => llmProviders["openai-compatible"]({})("m")).toThrow(/base URL/);
  });

  test("the providers schema accepts each provider's config and rejects a bad url", () => {
    const parsed = providersConfigSchema.parse({
      openai: { apiKey: "k" },
      anthropic: {
        authToken: "sk-ant-oat01-token",
        headers: { "anthropic-beta": "oauth-2025-04-20" },
      },
      azure: { apiKey: "k", resourceName: "r" },
      bedrock: { region: "us-east-1" },
      vertex: { project: "p", location: "us" },
    });
    expect(parsed.openai?.apiKey).toBe("k");
    expect(parsed.anthropic?.authToken).toBe("sk-ant-oat01-token");
    expect(() => providersConfigSchema.parse({ openai: { baseURL: "not-a-url" } })).toThrow();
  });

  test("Claude OAuth and API-key providers are in the secret-backed entry set", () => {
    expect(KEY_PROVIDERS).toContain("openai");
    expect(KEY_PROVIDERS).toContain("claude");
    expect(KEY_PROVIDERS).not.toContain("bedrock");
    expect(KEY_PROVIDERS).not.toContain("vertex");
  });

  test("Vertex resolves a location so ADC-only setup doesn't crash", () => {
    // Config wins.
    expect(resolveVertexSettings({ location: "europe-west1", project: "p" })).toEqual({
      location: "europe-west1",
      project: "p",
    });
    // Then env; project sniffs GOOGLE_CLOUD_PROJECT.
    expect(
      resolveVertexSettings(
        {},
        { GOOGLE_VERTEX_LOCATION: "us-west1", GOOGLE_CLOUD_PROJECT: "acme" },
      ),
    ).toEqual({ location: "us-west1", project: "acme" });
    // Nothing set → a sensible default location, project omitted (SDK/ADC resolves it).
    expect(resolveVertexSettings({}, {})).toEqual({ location: "global" });
  });

  test("Bedrock resolves a region: config → env → default", () => {
    expect(resolveBedrockRegion({ region: "eu-west-1" }, {})).toBe("eu-west-1");
    expect(resolveBedrockRegion({}, { AWS_DEFAULT_REGION: "ap-south-1" })).toBe("ap-south-1");
    expect(resolveBedrockRegion({}, {})).toBe("us-east-1");
  });
});
