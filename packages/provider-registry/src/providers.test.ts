import { describe, expect, test } from "bun:test";
import { createModel, currentModel } from "./models";
import { missingFor, PROVIDERS, providerSpec } from "./providers";

describe("the provider table", () => {
  test("covers the providers glrs ships a factory for", () => {
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
    expect(
      missingFor("ollama", { factoryOptions: { baseURL: "http://localhost:11434/v1" } }, bare),
    ).toEqual([]);
  });
});

// A local server, a gateway or a company proxy is reachable without glrs
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

  test("without one, resolution waits for an extension provider", () => {
    const model = createModel(currentModel({ model: "mystery/x" }));
    expect(() => model.provider).toThrow(/g\.provider/u);
  });

  test("a built-in provider is never diverted to the compatible path", () => {
    expect(providerSpec("anthropic")).toBeDefined();
    expect(missingFor("anthropic", undefined, { ANTHROPIC_API_KEY: "k" })).toEqual([]);
  });
});

// The canonical ids follow the SDK packages — google-vertex, amazon-bedrock —
// which are fine as identifiers and not what anyone types.
describe("the names people actually type", () => {
  test("common shorthands resolve to the built-in provider", () => {
    for (const [typed, meant] of [
      ["vertex", "google-vertex"],
      ["bedrock", "amazon-bedrock"],
      ["gemini", "google"],
      ["claude", "anthropic"],
      ["foundry", "azure"],
      ["together", "togetherai"],
      ["grok", "xai"],
    ])
      expect(currentModel({ model: `${typed}/some-model` }).provider).toBe(meant);
  });

  test("an alias keeps the model id intact", () => {
    expect(currentModel({ model: "vertex/gemini-3.7-flash" }).modelId).toBe("gemini-3.7-flash");
  });

  test("a near-miss is named rather than sent to configure a base URL", () => {
    expect(missingFor("vertexai", undefined, {})[0]).toContain("did you mean");
  });

  test("something genuinely unknown still gets the compatible instructions", () => {
    expect(missingFor("zzz", undefined, {})[0]).toContain("providers.zzz.api");
    expect(missingFor("zzz", undefined, {})[0]).not.toContain("did you mean");
  });

  test("an alias is not mistaken for an OpenAI-compatible endpoint", () => {
    expect(() => createModel(currentModel({ model: "vertex/x" }))).not.toThrow(/base URL/u);
  });
});
