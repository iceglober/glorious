import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { defineTool, llmConfigSchema } from ".";

describe("llmConfigSchema", () => {
  test("defaults: the Azure-deployed primary model, credentials left to the environment", () => {
    const llm = llmConfigSchema.parse({});
    expect(llm.model).toBe("gpt-5.6-luna");
    // Call settings are unset by default so the prompt profile's recommendation
    // is what reaches the model.
    expect(llm.temperature).toBeUndefined();
    expect(llm.topP).toBeUndefined();
  });

  test("credentials have no config path — the schema carries model and call settings only", () => {
    // An `azure` block is not part of the schema; it is stripped, never stored.
    expect(llmConfigSchema.parse({ azure: { apiKey: "secret" } })).not.toHaveProperty("azure");
    expect(llmConfigSchema.parse({ model: "gpt-5.6-sol" }).model).toBe("gpt-5.6-sol");
  });

  test("call settings are held to the ranges providers accept", () => {
    expect(llmConfigSchema.parse({ temperature: 0, topP: 1 })).toMatchObject({
      temperature: 0,
      topP: 1,
    });
    expect(llmConfigSchema.safeParse({ temperature: 2.5 }).success).toBe(false);
    expect(llmConfigSchema.safeParse({ temperature: -1 }).success).toBe(false);
    expect(llmConfigSchema.safeParse({ topP: 1.5 }).success).toBe(false);
  });
});

describe("defineTool", () => {
  test("keeps execute's input typed from the tool's own schema", async () => {
    const upper = defineTool({
      description: "uppercase a path",
      inputSchema: z.object({ path: z.string() }),
      // `path` is typed from inputSchema — no cast, no `any`.
      execute: async ({ path }) => path.toUpperCase(),
    });

    expect(await upper.execute({ path: "core/lib" })).toBe("CORE/LIB");
    expect(upper.inputSchema.safeParse({ path: 1 }).success).toBe(false);
  });

  test("carries an optional JSON Schema override for provider-neutral tools", () => {
    const schema = { type: "object", properties: { query: { type: "string" } } };
    const search = defineTool({
      description: "search",
      inputSchema: z.object({ query: z.string() }),
      jsonSchema: schema,
      execute: () => "result",
    });
    expect(search.jsonSchema).toEqual(schema);
  });
});
