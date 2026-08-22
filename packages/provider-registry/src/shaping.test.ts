import { describe, expect, test } from "bun:test";
import { type BuiltinProviderId, PROVIDERS } from "./providers";
import {
  cacheHint,
  cacheStrategyFor,
  cachesAutomatically,
  cacheTelemetryFor,
  endpointTypeFor,
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
    openrouter: "no-portable-control",
    groq: "no-portable-control",
    mistral: "no-portable-control",
    deepseek: "no-portable-control",
    cerebras: "no-portable-control",
    cohere: "no-portable-control",
    xai: "no-portable-control",
    perplexity: "no-portable-control",
    togetherai: "no-portable-control",
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
    ).toEqual({ kind: "no-portable-control" });
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
      kind: "no-portable-control",
    });
    expect(requestOptions({ provider: "ollama", modelId: "llama", cacheKey: "key" })).toEqual({});
  });

  test("cache telemetry capability is explicit for every built-in", () => {
    const expected = {
      anthropic: "read-write",
      openai: "read",
      azure: "read",
      google: "read",
      "google-vertex": "read",
      "amazon-bedrock": "read-write",
      openrouter: "read",
      groq: "read",
      mistral: "read",
      deepseek: "read",
      cerebras: "none",
      cohere: "none",
      xai: "read",
      perplexity: "none",
      togetherai: "none",
    } satisfies Record<BuiltinProviderId, ReturnType<typeof cacheTelemetryFor>>;
    for (const provider of PROVIDERS)
      expect(cacheTelemetryFor({ provider: provider.id })).toBe(
        expected[provider.id as BuiltinProviderId],
      );
    expect(cacheTelemetryFor({ provider: "google-vertex", modelId: "claude-opus-4" })).toBe(
      "read-write",
    );
    expect(cacheTelemetryFor({ provider: "ollama" })).toBe("conditional");
  });

  test("endpoint labels distinguish every routed Azure adapter", () => {
    expect(endpointTypeFor({ provider: "azure", modelType: "responses" })).toBe("azure-responses");
    expect(endpointTypeFor({ provider: "azure", modelType: "chat" })).toBe("azure-chat");
    expect(endpointTypeFor({ provider: "azure", modelType: "deepseek" })).toBe("azure-deepseek");
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

// Reasoning effort is not a fixed set. models.dev publishes what each model
// accepts, and the catalogue holds over a hundred distinct shapes, so a union
// in the code could only be right for a minority of models.
describe("variant follows the model, not a hardcoded list", () => {
  const anthropic = (variant: string, variants?: readonly string[]) =>
    requestOptions({ provider: "anthropic", modelId: "claude", variant, variants });

  test("a value the model does not offer is dropped, not forwarded", () => {
    // A provider that rejects it fails the turn; one that ignores it bills for
    // effort nobody chose.
    expect(anthropic("xhigh", ["low", "medium", "high"]).anthropic).toEqual({});
    expect(anthropic("medium", ["low", "medium", "high"]).anthropic).toHaveProperty("thinking");
  });

  test("a scale the code has never seen still works", () => {
    expect(anthropic("max", ["low", "medium", "high", "xhigh", "max"]).anthropic).toMatchObject({
      thinking: { type: "enabled" },
    });
    expect(anthropic("ludicrous", ["low", "ludicrous"]).anthropic).toMatchObject({
      thinking: { type: "enabled" },
    });
  });

  test("the budget spreads over the model's own scale", () => {
    const three = anthropic("high", ["low", "medium", "high"]).anthropic as {
      thinking: { budgetTokens: number };
    };
    const five = anthropic("max", ["low", "medium", "high", "xhigh", "max"]).anthropic as {
      thinking: { budgetTokens: number };
    };
    // Both are the top of their own scale, so both reach the ceiling.
    expect(three.thinking.budgetTokens).toBe(five.thinking.budgetTokens);
    const middle = anthropic("medium", ["low", "medium", "high"]).anthropic as {
      thinking: { budgetTokens: number };
    };
    expect(middle.thinking.budgetTokens).toBeLessThan(three.thinking.budgetTokens);
  });

  test("with no published scale it falls back rather than refusing", () => {
    expect(anthropic("high").anthropic).toHaveProperty("thinking");
  });

  test("bedrock sends a word only for the three it knows, and a budget always", () => {
    const wide = requestOptions({
      provider: "amazon-bedrock",
      modelId: "m",
      variant: "max",
      variants: ["low", "medium", "high", "xhigh", "max"],
    }).bedrock as { reasoningConfig: Record<string, unknown> };
    expect(wide.reasoningConfig).not.toHaveProperty("maxReasoningEffort");
    expect(wide.reasoningConfig).toHaveProperty("budgetTokens");
  });
});

// Azure now reads its own namespace and routes DeepSeek through chat (#326,
// #328). Those land alongside catalogue-driven variants, so this pins that both
// survive the same call.
describe("azure keeps its namespace while the variant follows the model", () => {
  test("azure reads the azure namespace, not openai's", () => {
    expect(Object.keys(requestOptions({ provider: "azure", modelId: "gpt-5.6" }))).toEqual([
      "azure",
    ]);
  });

  test("a variant azure's model does not publish is still dropped", () => {
    const wide = requestOptions({
      provider: "azure",
      modelId: "gpt-5.6",
      variant: "max",
      variants: ["low", "medium", "high"],
    }).azure;
    expect(wide).not.toHaveProperty("reasoningEffort");
  });

  test("and one it does publish is sent", () => {
    expect(
      requestOptions({
        provider: "azure",
        modelId: "gpt-5.6",
        variant: "high",
        variants: ["low", "medium", "high"],
      }).azure,
    ).toMatchObject({ reasoningEffort: "high" });
  });
});
