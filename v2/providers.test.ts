import { describe, expect, test } from "bun:test";
import { createModel, currentModel } from "./models";
import { missingFor, PROVIDERS, providerSpec } from "./providers";

describe("the provider table", () => {
  test("covers the providers glorious ships a factory for", () => {
    for (const id of ["anthropic", "openai", "azure", "google", "google-vertex", "amazon-bedrock"])
      expect(providerSpec(id)).toBeDefined();
  });

  test("every entry declares how to authenticate", () => {
    for (const provider of PROVIDERS) {
      expect(provider.label).not.toBe("");
      expect(provider.env.length + (provider.needs?.length ?? 0)).toBeGreaterThan(0);
    }
  });

  // Azure answers to three names between the portal, the CLI and the SDK, and
  // the SDK reads only one of them — which is how a session could fail with a
  // key sitting right there in the environment.
  test("azure keeps all three of its names, in precedence order", () => {
    expect(providerSpec("azure")?.env).toEqual([
      "AZURE_FOUNDRY_API_KEY",
      "AZURE_API_KEY",
      "AZURE_OPENAI_API_KEY",
    ]);
  });

  test("every provider's credentials reach the model it resolves", () => {
    for (const provider of PROVIDERS)
      expect(currentModel({ model: `${provider.id}/x` }).env).toEqual(provider.env);
  });
});

describe("what doctor reports as missing", () => {
  const bare = {} as NodeJS.ProcessEnv;

  test("a key that is not set", () => {
    expect(missingFor("anthropic", undefined, bare)).toEqual(["ANTHROPIC_API_KEY"]);
  });

  test("any one of the accepted names satisfies it", () => {
    expect(
      missingFor("azure", undefined, { AZURE_API_KEY: "k", AZURE_RESOURCE_NAME: "r" }),
    ).toEqual([]);
  });

  test("what a provider needs beyond a key", () => {
    expect(missingFor("azure", undefined, { AZURE_API_KEY: "k" })).toContain("AZURE_RESOURCE_NAME");
  });

  test("an unknown provider needs a base URL, and says so", () => {
    expect(missingFor("ollama", undefined, bare)[0]).toContain("providers.ollama.api");
    expect(missingFor("ollama", { api: "http://localhost:11434/v1" }, bare)).toEqual([]);
  });
});

// A local server, a gateway or a company proxy is reachable without glorious
// shipping a factory for it. This used to throw "Provider x is not supported"
// unless models.dev happened to publish it, which no local server does.
describe("OpenAI-compatible endpoints", () => {
  test("an unknown provider with a base URL is routed there", () => {
    const model = currentModel({
      model: "ollama/llama3",
      providers: { ollama: { api: "http://localhost:11434/v1" } },
    });
    expect(() => createModel(model)).not.toThrow();
  });

  test("without one, the error says exactly what to add", () => {
    expect(() => createModel(currentModel({ model: "mystery/x" }))).toThrow(/base URL/u);
  });

  test("a built-in provider is never diverted to the compatible path", () => {
    expect(providerSpec("anthropic")).toBeDefined();
    expect(missingFor("anthropic", undefined, { ANTHROPIC_API_KEY: "k" })).toEqual([]);
  });
});
