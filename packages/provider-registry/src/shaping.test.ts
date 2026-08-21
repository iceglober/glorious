import { describe, expect, test } from "bun:test";
import { type BuiltinProviderId, PROVIDERS } from "./providers";
import {
  cacheHint,
  cacheStrategyFor,
  cachesAutomatically,
  namespaceFor,
  requestOptions,
  withCacheBreakpoints,
} from "./shaping";

// Prompt caching and reasoning effort were both written for OpenAI and applied
// to everyone. These pin that each provider is asked in its own words.

describe("which namespace a provider reads", () => {
  test("azure follows the selected endpoint adapter", () => {
    expect(namespaceFor("azure", "gpt-5.6-luna")).toBe("azure");
    expect(namespaceFor("azure", "private", "responses")).toBe("azure");
    expect(namespaceFor("azure", "private", "chat")).toBe("openai");
    expect(namespaceFor("azure", "deepseek-v4-flash")).toBe("azure");
  });

  test("vertex follows the model, not the host", () => {
    expect(namespaceFor("google-vertex", "claude-opus-4-1")).toBe("anthropic");
    expect(namespaceFor("google-vertex", "gemini-3-pro")).toBe("google");
  });

  test("an unknown provider uses the generic compatible namespace", () => {
    expect(namespaceFor("ollama")).toBe("openaiCompatible");
  });
});

describe("reasoning effort reaches the provider that answers", () => {
  test("no provider is handed a namespace it does not read", () => {
    for (const [provider, namespace] of [
      ["anthropic", "anthropic"],
      ["google", "google"],
      ["amazon-bedrock", "bedrock"],
      ["openai", "openai"],
    ] as const) {
      const options = requestOptions({ provider, modelId: "m", variant: "high" });
      expect(Object.keys(options)).toEqual([namespace]);
    }
  });

  test("each spelling matches what its SDK accepts", () => {
    expect(requestOptions({ provider: "anthropic", modelId: "c", variant: "high" })).toMatchObject({
      anthropic: { thinking: { type: "enabled" } },
    });
    expect(requestOptions({ provider: "google", modelId: "g", variant: "low" })).toMatchObject({
      google: { thinkingConfig: { includeThoughts: true } },
    });
    expect(
      requestOptions({ provider: "amazon-bedrock", modelId: "b", variant: "medium" }),
    ).toMatchObject({ bedrock: { reasoningConfig: { maxReasoningEffort: "medium" } } });
  });

  test("Azure DeepSeek gets only the options its chat adapter accepts", () => {
    expect(
      requestOptions({ provider: "azure", modelId: "deepseek-v4-flash", variant: "max" }),
    ).toEqual({ azure: { reasoningEffort: "max" } });
  });

  test("extended efforts are forwarded rather than silently discarded", () => {
    expect(requestOptions({ provider: "openai", modelId: "o", variant: "xhigh" })).toHaveProperty(
      "openai.reasoningEffort",
      "xhigh",
    );
    expect(requestOptions({ provider: "openai", modelId: "o", variant: "max" })).toHaveProperty(
      "openai.reasoningEffort",
      "max",
    );
  });

  test("an effort nobody configured asks for none", () => {
    expect(requestOptions({ provider: "anthropic", modelId: "c" }).anthropic).toEqual({});
    expect(requestOptions({ provider: "openai", modelId: "o" }).openai).not.toHaveProperty(
      "reasoningEffort",
    );
  });

  test("a word that is not an effort is ignored rather than forwarded", () => {
    expect(
      requestOptions({ provider: "openai", modelId: "o", variant: "turbo" }).openai,
    ).not.toHaveProperty("reasoningEffort");
  });
});

describe("cache strategy matrix", () => {
  const expected = {
    anthropic: "message-breakpoint",
    openai: "routing-key",
    azure: "routing-key",
    google: "automatic",
    "google-vertex": "automatic",
    "amazon-bedrock": "message-breakpoint",
    openrouter: "provider-managed",
    groq: "provider-managed",
    mistral: "provider-managed",
    deepseek: "provider-managed",
    cerebras: "provider-managed",
    cohere: "provider-managed",
    xai: "provider-managed",
    perplexity: "provider-managed",
    togetherai: "provider-managed",
  } satisfies Record<BuiltinProviderId, ReturnType<typeof cacheStrategyFor>["kind"]>;

  test("every built-in provider has an intentional strategy", () => {
    expect(Object.keys(expected).sort()).toEqual(PROVIDERS.map(({ id }) => id).sort());
    for (const provider of PROVIDERS)
      expect(cacheStrategyFor({ provider: provider.id, modelId: "model" }).kind).toBe(
        expected[provider.id as BuiltinProviderId],
      );
  });

  test("azure endpoint types select only cache controls their adapter supports", () => {
    expect(cacheStrategyFor({ provider: "azure", modelId: "gpt", modelType: "responses" })).toEqual(
      { kind: "routing-key", namespace: "azure" },
    );
    expect(cacheStrategyFor({ provider: "azure", modelId: "gpt", modelType: "chat" })).toEqual({
      kind: "routing-key",
      namespace: "openai",
    });
    expect(
      cacheStrategyFor({ provider: "azure", modelId: "deepseek-v4", modelType: "deepseek" }),
    ).toEqual({ kind: "provider-managed" });
  });

  test("vertex strategy follows the served model", () => {
    expect(cacheStrategyFor({ provider: "google-vertex", modelId: "gemini-3-pro" })).toEqual({
      kind: "automatic",
    });
    expect(cacheStrategyFor({ provider: "google-vertex", modelId: "claude-opus-4" })).toEqual({
      kind: "message-breakpoint",
      namespace: "anthropic",
    });
  });

  test("compatible endpoints use only portable options and own their cache", () => {
    expect(cacheStrategyFor({ provider: "ollama", modelId: "llama" })).toEqual({
      kind: "provider-managed",
    });
    expect(requestOptions({ provider: "ollama", modelId: "llama", cacheKey: "key" })).toEqual({});
  });

  test("extension providers own caching even when reusing a built-in id", () => {
    expect(cacheStrategyFor({ provider: "anthropic" }, "extension")).toEqual({
      kind: "extension-managed",
    });
    expect(cacheHint("anthropic", "model", undefined, "extension")).toBeUndefined();
    expect(
      requestOptions({ provider: "openai", modelId: "model", cacheKey: "key" }, "extension"),
    ).not.toHaveProperty("openai.promptCacheKey");
  });
});

describe("cache breakpoints", () => {
  const conversation = (n: number) =>
    Array.from({ length: n }, (_, at) => ({ role: "user", content: `m${at}` }));

  test("providers that cache a prefix unasked are handed the list unchanged", () => {
    expect(cachesAutomatically("openai")).toBe(true);
    expect(cachesAutomatically("google")).toBe(true);
    expect(cachesAutomatically("azure", "gpt-5.6-luna")).toBe(true);
    expect(cachesAutomatically("azure", "private", "chat")).toBe(true);
    expect(cachesAutomatically("azure", "deepseek-v4-flash")).toBe(false);
    expect(cacheHint("openai")).toBeUndefined();
    const messages = conversation(4);
    expect(withCacheBreakpoints(messages, "openai")).toEqual(messages);
  });

  test("anthropic and bedrock cache only what is marked, so it is marked", () => {
    expect(cachesAutomatically("anthropic")).toBe(false);
    const marked = withCacheBreakpoints(conversation(4), "anthropic");
    // Second-to-last: the newest point that will still be here next turn.
    expect(marked[2]).toHaveProperty("providerOptions.anthropic.cacheControl");
    expect(marked[3]).not.toHaveProperty("providerOptions");
    expect(marked[0]).not.toHaveProperty("providerOptions");
  });

  test("bedrock gets a cachePoint rather than anthropic's cacheControl", () => {
    const marked = withCacheBreakpoints(conversation(3), "amazon-bedrock");
    expect(marked[1]).toHaveProperty("providerOptions.bedrock.cachePoint");
  });

  test("a claude model on vertex is marked the anthropic way", () => {
    const marked = withCacheBreakpoints(conversation(3), "google-vertex", "claude-opus-4-1");
    expect(marked[1]).toHaveProperty("providerOptions.anthropic.cacheControl");
  });

  test("too short to have a stable prefix means nothing is marked", () => {
    expect(withCacheBreakpoints(conversation(1), "anthropic")[0]).not.toHaveProperty(
      "providerOptions",
    );
  });

  test("options a message already carried are kept", () => {
    const messages = [
      { role: "user", providerOptions: { openai: { store: false } } },
      { role: "user" },
    ];
    const marked = withCacheBreakpoints(messages, "anthropic");
    expect(marked[0]).toHaveProperty("providerOptions.openai.store", false);
    expect(marked[0]).toHaveProperty("providerOptions.anthropic.cacheControl");
  });

  test("extension providers receive no glrs cache breakpoint", () => {
    const messages = conversation(3);
    expect(withCacheBreakpoints(messages, "anthropic", "model", undefined, "extension")).toEqual(
      messages,
    );
  });
});
