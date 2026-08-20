import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_SCHEMA_URL } from "../../packages/provider-registry/src/config";

const schema = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "public", "config.schema.json"), "utf8"),
) as {
  $id: string;
  properties: Record<string, unknown>;
  $defs: Record<string, { properties?: Record<string, unknown> }>;
};

describe("hosted config schema", () => {
  test("uses the public glrs.dev URL", () => {
    expect(schema.$id).toBe(CONFIG_SCHEMA_URL);
  });

  test("uses camelCase for every config key", () => {
    expect(
      Object.keys(schema.properties).some((key) => key !== "$schema" && key.includes("_")),
    ).toBe(false);
  });

  test("describes provider passthrough and exact model overrides", () => {
    const providers = schema.properties.providers as {
      additionalProperties: { properties: Record<string, unknown> };
    };
    for (const key of [
      "factoryOptions",
      "requestOptions",
      "providerOptions",
      "models",
    ])
      expect(providers.additionalProperties.properties).toHaveProperty(key);
    expect(schema.$defs.factoryOptions.properties?.fetch).toBe(false);
    expect(schema.$defs.factoryOptions.properties).toHaveProperty("baseURL");
    expect(schema.$defs.factoryOptions.properties).toHaveProperty("headers");
    expect(schema.$defs.requestOptions.properties).toHaveProperty("temperature");
    expect(schema.$defs.requestOptions.properties).toHaveProperty("maxOutputTokens");
    expect(schema.$defs.requestOptions.properties?.messages).toBe(false);
    expect(schema.$defs.requestOptions.properties?.tools).toBe(false);
    const openai = schema.$defs.providerOptions.properties?.openai as {
      properties?: Record<string, unknown>;
    };
    expect(openai.properties).toHaveProperty("reasoningEffort");
    expect(openai.properties).toHaveProperty("store");
  });

  test("covers every documented top-level setting", () => {
    for (const key of [
      "$schema",
      "model",
      "variant",
      "toolTimeoutMs",
      "steeringMode",
      "followUpMode",
      "extensions",
      "tools",
      "agentConfigAllowlist",
      "providers",
    ])
      expect(schema.properties).toHaveProperty(key);
  });
});
