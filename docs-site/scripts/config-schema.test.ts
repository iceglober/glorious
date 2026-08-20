import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CONFIG_SCHEMA_URL } from "../../packages/provider-registry/src/config";

const schema = JSON.parse(
  readFileSync(join(import.meta.dir, "..", "public", "config.schema.json"), "utf8"),
) as {
  $id: string;
  properties: Record<string, unknown>;
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
