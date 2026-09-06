import { describe, expect, test } from "bun:test";
import { createProviderRegistry } from "./index";

describe("provider registry", () => {
  test("registers and resolves provider adapters", () => {
    const registry = createProviderRegistry();
    const provider = {
      id: "test",
      credentials: { provider: "test", environment: ["TEST_API_KEY"] },
      model: (modelId: string) => ({ modelId }),
    };
    registry.register(provider);
    expect(registry.get("test")).toBe(provider);
    expect(registry.list()).toEqual([provider]);
  });
});
