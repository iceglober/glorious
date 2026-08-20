import { describe, expect, test } from "bun:test";
import {
  cacheHint,
  cachesAutomatically,
  namespaceFor,
  requestOptions,
  withCacheBreakpoints,
} from "./shaping";

// Prompt caching and reasoning effort were both written for OpenAI and applied
// to everyone. These pin that each provider is asked in its own words.

describe("which namespace a provider reads", () => {
  test("azure is served by the openai SDK, so it reads openai's", () => {
    expect(namespaceFor("azure")).toBe("openai");
  });

  test("vertex follows the model, not the host", () => {
    expect(namespaceFor("google-vertex", "claude-opus-4-1")).toBe("anthropic");
    expect(namespaceFor("google-vertex", "gemini-3-pro")).toBe("google");
  });

  test("an unknown provider is OpenAI-compatible here as everywhere else", () => {
    expect(namespaceFor("ollama")).toBe("openai");
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

describe("cache breakpoints", () => {
  const conversation = (n: number) =>
    Array.from({ length: n }, (_, at) => ({ role: "user", content: `m${at}` }));

  test("providers that cache a prefix unasked are handed the list unchanged", () => {
    expect(cachesAutomatically("openai")).toBe(true);
    expect(cachesAutomatically("google")).toBe(true);
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
});
