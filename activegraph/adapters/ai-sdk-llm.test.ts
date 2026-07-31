import { describe, expect, test } from "bun:test";
import { createAzureLlm } from "./ai-sdk-llm";

describe("Azure LLM adapter", () => {
  test("maps an ActiveGraph request to generated text", async () => {
    let received: unknown;
    const llm = createAzureLlm({
      model: "deployment",
      apiKey: "test-key",
      resourceName: "test-resource",
      generate: async (request) => {
        received = request;
        return { text: "response" };
      },
    });

    const result = await llm.complete({
      system: "system prompt",
      prompt: "user prompt",
      temperature: 0,
    });

    expect(result).toEqual({ ok: true, value: { text: "response" } });
    expect(received).toMatchObject({
      system: "system prompt",
      prompt: "user prompt",
      temperature: 0,
    });
  });

  test("the request's deployment overrides the configured default", async () => {
    const deployments: string[] = [];
    const llm = createAzureLlm({
      model: "default-deployment",
      apiKey: "test-key",
      resourceName: "test-resource",
      generate: async (request) => {
        deployments.push(typeof request.model === "string" ? request.model : request.model.modelId);
        return { text: "response" };
      },
    });

    await llm.complete({ prompt: "no model named" });
    await llm.complete({ prompt: "model named", model: "other-deployment" });

    expect(deployments).toEqual(["default-deployment", "other-deployment"]);
  });

  test("turns provider failures into a port error", async () => {
    const llm = createAzureLlm({
      model: "deployment",
      apiKey: "test-key",
      resourceName: "test-resource",
      generate: async () => {
        throw new Error("network unavailable");
      },
    });

    expect(await llm.complete({ system: "system", prompt: "prompt", temperature: 0 })).toEqual({
      ok: false,
      error: { reason: "provider_error", message: "network unavailable" },
    });
  });
});
