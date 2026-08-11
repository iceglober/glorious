import { describe, expect, test } from "bun:test";
import { loadModels, modelCost, priceMultiplier } from "./models";

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
