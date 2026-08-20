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

  test("covers every documented top-level setting", () => {
    for (const key of [
      "$schema",
      "model",
      "variant",
      "tool_timeout_ms",
      "steering_mode",
      "follow_up_mode",
      "extensions",
      "tools",
      "agentConfigAllowlist",
      "providers",
    ])
      expect(schema.properties).toHaveProperty(key);
  });
});
